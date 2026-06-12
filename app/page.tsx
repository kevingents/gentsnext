export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-6 py-16">
      <p className="text-sm font-medium uppercase tracking-widest text-slate">
        GENTS Herenmode
      </p>
      <h1 className="text-4xl font-semibold">gentsnext</h1>
      <p className="text-lg text-slate">
        Fundament van de nieuwe gents.nl: Next.js-storefront met eigen
        commerce-database (Neon Postgres) en Mollie-checkout. Deze pagina is een
        tijdelijke statuspagina en verdwijnt zodra de storefront vorm krijgt.
      </p>
      <ul className="list-disc space-y-1 pl-5 text-slate">
        <li>Catalogus-schema: producten, varianten, prijshistorie (Omnibus), collecties, voorraadspiegel</li>
        <li>Import vanuit Shopify (bulk-export en bootstrap vanuit de bestaande cache)</li>
        <li>Products-cache-publisher, compatibel met de storegents-portal-API</li>
      </ul>
      <p className="text-sm text-slate">
        Status: <a className="underline" href="/api/health">/api/health</a>
      </p>
    </main>
  );
}
