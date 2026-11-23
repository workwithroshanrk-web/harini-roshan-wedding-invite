"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="login paper">
      <h1>A little pause.</h1>
      <p>
        We couldn’t load this page. Please try again, or contact the wedding
        hosts if this continues.
      </p>
      <button onClick={reset}>Try again</button>
      <p>
        <a href="/">Return to the invitation</a>
      </p>
    </main>
  );
}
