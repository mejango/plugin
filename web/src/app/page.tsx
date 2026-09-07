import { HomeHero } from "@/components/HomeHero";
import { SiteHeader } from "@/components/SiteHeader";

export default function HomePage() {
  return (
    <main className="pointer-events-none relative z-[2] min-h-[100svh]">
      <SiteHeader floating />
      <HomeHero />
    </main>
  );
}
