import { Box, Cloud, Code2, Gamepad2, Gift, Globe, Music, Shield, Sparkles, Wrench, type LucideIcon } from "lucide-react";
import type { CategoryIcon as IconName } from "~/lib/domain";

const ICONS: Record<IconName, LucideIcon> = {
  sparkles: Sparkles,
  gamepad: Gamepad2,
  code: Code2,
  wrench: Wrench,
  box: Box,
  music: Music,
  shield: Shield,
  globe: Globe,
  cloud: Cloud,
  gift: Gift,
};

export function CategoryIcon({ name, className }: { name: IconName; className?: string }) {
  const Icon = ICONS[name] ?? Box;
  return <Icon className={className} />;
}
