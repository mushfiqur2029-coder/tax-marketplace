const TAGS = [
  "SELF ASSESSMENT",
  "VAT RETURNS",
  "CIS REBATES",
  "LANDLORD TAX",
  "SOLE TRADER",
  "LIMITED COMPANY",
];

export function LogoStrip() {
  const doubled = [...TAGS, ...TAGS, ...TAGS, ...TAGS];
  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6">
      <div className="text-center text-[12.5px] font-semibold text-slate">
        Built for individuals, freelancers, landlords &amp; VAT-registered
        businesses
      </div>
      <div className="marquee mt-5">
        <div className="marquee-track">
          {doubled.map((tag, i) => (
            <span key={`${tag}-${i}`}>
              {tag}
              {i < doubled.length - 1 ? (
                <span className="ml-[60px]">·</span>
              ) : null}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
