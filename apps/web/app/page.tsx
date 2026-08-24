import { ConnectForm } from "@/components/ConnectForm";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center px-6 py-16">
      <p className="display text-sm text-lime">GridironAI · Sprint 1</p>
      <h1 className="display mt-3 max-w-3xl text-6xl leading-[0.9] text-clay md:text-8xl">
        Call the play
        <span className="block text-lime">before the snap.</span>
      </h1>
      <p className="mt-6 max-w-xl text-lg text-muted">
        Connect a Sleeper username. We ingest your leagues, scoring settings, and rosters — the
        foundation for start/sit, FAAB, and the copilot debate.
      </p>
      <div className="mt-10">
        <ConnectForm />
      </div>
    </main>
  );
}
