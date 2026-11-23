import "./globals.css";
export const metadata = {
  title: "Harini & Roshan · Together",
  description: "A celebration of love, family and togetherness",
  robots: { index: false, follow: false },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
