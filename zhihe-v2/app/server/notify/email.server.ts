export function isEmailConfigured(env: Env): boolean {
  return Boolean(env.RESEND_API_KEY && env.EMAIL_FROM);
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Sends a transactional email through Resend. Never throws. */
export async function sendEmail(env: Env, message: { to: string; subject: string; html: string; text: string }): Promise<boolean> {
  if (!isEmailConfigured(env)) return false;
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.EMAIL_FROM, to: [message.to], subject: message.subject, html: message.html, text: message.text }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) console.warn("email send failed", response.status);
    return response.ok;
  } catch (error) {
    console.warn("email send error", error instanceof Error ? error.message : error);
    return false;
  }
}

export function emailLayout(storeName: string, heading: string, body: string, cta?: { label: string; url: string }): string {
  const button = cta
    ? `<p style="margin:28px 0"><a href="${escapeHtml(cta.url)}" style="background:#6d5dfc;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600;display:inline-block">${escapeHtml(cta.label)}</a></p>`
    : "";
  return `<!doctype html><html><body style="margin:0;background:#0b0c10;padding:32px 16px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#e8e9ee">
<table role="presentation" width="100%" style="max-width:560px;margin:0 auto;background:#12141b;border:1px solid #23262f;border-radius:16px">
<tr><td style="padding:32px">
<p style="margin:0 0 24px;font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#9a9db0">${escapeHtml(storeName)}</p>
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#fff">${escapeHtml(heading)}</h1>
<div style="font-size:15px;line-height:1.6;color:#c4c6d2">${body}</div>
${button}
</td></tr></table></body></html>`;
}
