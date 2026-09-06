import { HomeHero } from "@/components/HomeHero";
import { SiteHeader } from "@/components/SiteHeader";

export default function HomePage() {
  return (
    <main className="pointer-events-none relative z-[2] flex min-h-[100svh] items-center justify-center px-[6vw] text-center">
      <SiteHeader floating />
      <HomeHero />
    </main>
  );
}
