import { describe, expect, it } from "vitest";
import { parseBlocks, parseInline } from "~/lib/markdown";
import { formatMoney, minorToInput, parseMoneyInput } from "~/lib/money";
import { pickText } from "~/lib/localized";
import { quantityDiscountPercent } from "~/lib/pricing";
import { computeBaseQuote, promoDiscountAmount } from "~/server/pricing.server";
import { hashPassword, verifyPassword, timingSafeEqual } from "~/server/crypto.server";
import { matchAcceptLanguage } from "~/i18n/config";
import { adminEn } from "~/i18n/locales/admin.en";
import { adminRu } from "~/i18n/locales/admin.ru";
import { adminZh } from "~/i18n/locales/admin.zh";
import { storeEn } from "~/i18n/locales/store.en";
import { storeRu } from "~/i18n/locales/store.ru";
import { storeZh } from "~/i18n/locales/store.zh";

describe("money", () => {
  it("parses decimal input into minor units", () => {
    expect(parseMoneyInput("12.5")).toBe(1250);
    expect(parseMoneyInput("12,05")).toBe(1205);
    expect(parseMoneyInput("abc")).toBeNull();
    expect(parseMoneyInput("1.234")).toBeNull();
    expect(minorToInput(1205)).toBe("12.05");
  });
  it("formats with and without cents", () => {
    expect(formatMoney(2200, "USD", "en")).toBe("$22");
    expect(formatMoney(5220, "USD", "en")).toBe("$52.20");
  });
});

describe("pricing", () => {
  const tiers = [{ minQuantity: 3, percent: 3 }, { minQuantity: 5, percent: 5 }];
  it("applies the highest reached quantity tier", () => {
    expect(quantityDiscountPercent(tiers, 2)).toBe(0);
    expect(quantityDiscountPercent(tiers, 4)).toBe(3);
    expect(quantityDiscountPercent(tiers, 9)).toBe(5);
    expect(computeBaseQuote(1000, 5, "USD", tiers)).toMatchObject({ subtotal: 5000, quantityDiscount: 250, total: 4750 });
  });
  it("never discounts below zero", () => {
    expect(promoDiscountAmount({ type: "fixed", value: 99_999 }, 1000)).toBe(1000);
    expect(promoDiscountAmount({ type: "percent", value: 10 }, 5800)).toBe(580);
  });
});

describe("markdown", () => {
  it("drops unsafe links", () => {
    const nodes = parseInline("[x](javascript:alert(1)) and [ok](https://a.b)");
    expect(nodes.some((node) => node.type === "link" && node.href.startsWith("javascript"))).toBe(false);
    expect(nodes.some((node) => node.type === "link" && node.href === "https://a.b")).toBe(true);
  });
  it("parses lists and headings", () => {
    const blocks = parseBlocks("## Title\n- a\n- b\n\n1. one\n2. two\n\ntext");
    expect(blocks.map((block) => block.type)).toEqual(["heading", "list", "list", "paragraph"]);
  });
});

describe("i18n", () => {
  it("falls back to English then any language", () => {
    expect(pickText({ en: "Hi", ru: "Привет" }, "zh")).toBe("Hi");
    expect(pickText({ ru: "Привет" }, "zh")).toBe("Привет");
  });
  it("matches Accept-Language", () => {
    expect(matchAcceptLanguage("zh-CN,zh;q=0.9,en;q=0.8")).toBe("zh");
    expect(matchAcceptLanguage("de-DE,ru;q=0.5")).toBe("ru");
  });
  it("keeps placeholders consistent across translations", () => {
    const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
    for (const [source, targets] of [[storeEn, [storeRu, storeZh]], [adminEn, [adminRu, adminZh]]] as const) {
      for (const [key, text] of Object.entries(source)) {
        for (const target of targets) expect(placeholders((target as Record<string, string>)[key] ?? ""), key).toBe(placeholders(text));
      }
    }
  });
});

describe("crypto", () => {
  it("hashes and verifies passwords", async () => {
    const hash = await hashPassword("correct-horse-battery");
    expect(await verifyPassword("correct-horse-battery", hash)).toBe(true);
    expect(await verifyPassword("wrong-password-123", hash)).toBe(false);
  });
  it("compares in constant time", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
  });
});
