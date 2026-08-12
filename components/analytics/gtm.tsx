"use client";

import Script from "next/script";
import { useEffect } from "react";
import { readConsent } from "@/lib/consent";
import { pushDataLayer, zetConsentDefaults } from "@/lib/datalayer";

/**
 * Google Tag Manager — het doorgeefluik naar Google Ads, GA4 en Meta.
 *
 * Waarom een container en niet de tags rechtstreeks: de marketingkant wil tags
 * kunnen toevoegen zonder een deploy, en wij willen niet dat elke nieuwe tag
 * een codewijziging is. De afspraak die daarbij hoort staat in de dataLayer:
 * GTM krijgt alleen wat lib/track-client afvuurt, in de namen uit
 * lib/event-catalog. Tags die zelf gaan meten (auto-events, scroll-listeners,
 * form-detectie) horen hier niet thuis — dan ontstaat er een tweede
 * administratie die op een dag niet meer klopt met de onze.
 *
 * VOLGORDE IS DE HELE TRUC. Consent Mode v2 moet in de dataLayer staan vóórdat
 * het GTM-script laadt, met alles op `denied`. Draait het andersom, dan meet de
 * eerste paginaweergave nog vol mee en is de toestemming een formaliteit. Daarom
 * de defaults in een `beforeInteractive`-script en de container pas daarna.
 *
 * Zonder NEXT_PUBLIC_GTM_ID rendert dit niets. De site blijft dan draaien op de
 * eigen first-party meting, precies zoals nu — GTM is een toevoeging, geen
 * vervanging.
 */
export function GoogleTagManager() {
  const id = process.env.NEXT_PUBLIC_GTM_ID || "";

  useEffect(() => {
    if (!id) return;
    // Al een keuze gemaakt in een eerder bezoek? Zet die meteen door, anders
    // blijft Consent Mode op `denied` staan terwijl de bezoeker al ja zei.
    const c = readConsent();
    if (c) {
      pushDataLayer({
        event: "consent_update",
        consent: {
          ad_storage: c.marketing ? "granted" : "denied",
          ad_user_data: c.marketing ? "granted" : "denied",
          ad_personalization: c.marketing ? "granted" : "denied",
          analytics_storage: c.analytics ? "granted" : "denied",
          functionality_storage: "granted",
          security_storage: "granted",
        },
      });
    }
  }, [id]);

  if (!id) return null;

  return (
    <>
      <Script id="gents-consent-default" strategy="beforeInteractive">
        {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}
gtag('consent','default',{ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',analytics_storage:'denied',functionality_storage:'granted',security_storage:'granted',wait_for_update:500});`}
      </Script>
      <Script id="gents-gtm" strategy="afterInteractive">
        {`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});
var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';
j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','${id}');`}
      </Script>
    </>
  );
}

/** Voor het geval JavaScript uitstaat. Alleen zinvol mét een container-id. */
export function GoogleTagManagerNoscript() {
  const id = process.env.NEXT_PUBLIC_GTM_ID || "";
  if (!id) return null;
  return (
    <noscript>
      <iframe
        src={`https://www.googletagmanager.com/ns.html?id=${id}`}
        height="0"
        width="0"
        style={{ display: "none", visibility: "hidden" }}
        title="Google Tag Manager"
      />
    </noscript>
  );
}

/** Alleen de defaults, voor pagina's zonder container (zodat de volgorde klopt). */
export function ConsentDefaults() {
  useEffect(() => {
    zetConsentDefaults();
  }, []);
  return null;
}
