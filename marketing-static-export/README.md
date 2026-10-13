# Sterling Ledger, static marketing site

This folder is the deployable static marketing site. Upload its
contents into cPanel's `public_html/` and the domain
`sterlingledger.co.uk` is live. Nothing in here needs Node, PHP, or
any runtime, it's plain HTML + CSS + JS.

## What's where

```
public_html/
  index.html             ,  / homepage
  about/index.html       ,  /about
  calculators/index.html ,  /calculators
  guides/index.html      ,  /guides
  self-employed/index.html
  landlords/index.html
  first-time-filers/index.html
  high-earners/index.html
  investors/index.html
  expats/index.html
  cis-construction/index.html
  limited-company-tax-returns/index.html
  ltd-company-directors/index.html
  vat-business/index.html
  making-tax-digital/index.html
  tax-advice/index.html
  _next/static/...       ,  CSS + fonts the pages reference
  sterling.js, mobile menu, FAQ, tabs, live pricing
  (plus every file from the project's /public/)
```

Each page has its own `<head>` with a tuned `<title>` + meta
description for SEO. Prices are populated at build time as a fallback
and refreshed live on page load from the admin-edited catalog at
`https://apisterlingledger.co.uk/api/public/pricing`.

## Live pricing, how it works

`sterling.js` fetches the public pricing endpoint on every page load
and swaps the HTML text inside any element with the attribute
`data-tier-price="{tier_id}"` to match the live catalog value. When a
sale is set on a tier (`salePriceGbp` non-null), the swap renders
`<s>£regular</s> £sale` styling via two inner spans (`.price-was`
+ `.price-now`) you can style with CSS.

If the API call fails (network, CORS, DNS), the HTML's built-in
price stays visible, users never see a blank price card.

## Internal links

All login / register / dashboard / case-flow links go to
`https://apisterlingledger.co.uk/*`. The marketing site itself only
serves this folder.

## Rebuilding

From the Next.js project root with the dev server running at
`localhost:3000` and NO signed-in session (otherwise the homepage
redirects away from the marketing content), run:

```
node scripts/build-marketing-static.mjs
```

Then upload the regenerated `marketing-static-export/` to cPanel.

## cPanel upload tips

- Compress the folder to a .zip or .tar.gz locally, upload once, then
  extract on the server. Much faster than FTPing 100+ files.
- Set `AddDefaultCharset UTF-8` in your `.htaccess` so meta tags
  render correctly.
- Consider adding `.htaccess` rules for pretty URLs
  (`/landlords` → `/landlords/index.html`) if your cPanel server
  isn't already configured to serve index.html on folder requests.

## SEO work later

Each page is a standalone HTML file. Add structured data
(`<script type="application/ld+json">`), tweak meta descriptions,
add Open Graph tags, drop in a Plausible snippet, etc. ,  all
without touching the Next.js app or doing a code deploy. Just edit
the HTML and re-upload.
