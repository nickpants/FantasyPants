import { createFileRoute, Link } from "@tanstack/react-router";
import { ConnectForm } from "@/components/ConnectForm";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center px-6 py-16">
      <p className="display text-sm text-lime">GridironAI · Sleeper copilot</p>
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
      <p className="mt-8">
        <Link to="/help" className="display text-sm text-lime underline decoration-lime/40 underline-offset-4">
          How to use it · how rankings are built
        </Link>
      </p>
    </main>
  );
}