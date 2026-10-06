import { AuthFrame } from "./frame";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <AuthFrame>{children}</AuthFrame>;
}
