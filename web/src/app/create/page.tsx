import { CreateForm } from "@/components/create/CreateForm";
import { SiteHeader } from "@/components/SiteHeader";

export const metadata = {
  title: "Plug in — plugin.money",
};

export default function CreatePage() {
  return (
    // Scroll the foreground independently so opening the form cannot resize
    // the viewport-sized board or regenerate it when a scrollbar appears.
    <div className="fixed inset-0 z-[2] overflow-y-auto overscroll-contain bg-white/[.65]">
      <SiteHeader back />
      <main className="relative z-[2] mx-auto max-w-[900px] px-[6vw] pb-[12vh] pt-[7vh]">
        <h1 className="display text-[clamp(2.6rem,9vw,5.5rem)]">Plug in</h1>
        <p className="mt-[1.2rem] max-w-[46ch] text-[clamp(1.05rem,2vw,1.3rem)]">
          Give your machine a money engine so it can fundraise, process revenues, and manage incentives between machines.
        </p>
        <CreateForm />
      </main>
    </div>
  );
}
