import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "법령 컴플라이언스 어시스턴트",
  description:
    "산업안전보건 중심 법령 질문에 대해 기준일과 검증 상태를 분리해 안내하는 컴플라이언스 보조 도구입니다.",
};

type RootLayoutProps = {
  children: React.ReactNode;
};

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
