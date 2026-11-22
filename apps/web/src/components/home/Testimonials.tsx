import { Section, Title } from "@/components/home/Section";
import { REVIEWS_AND_STATS } from "@/lib/testimonials";

const cardClass = "flex min-h-[140px] flex-col justify-between gap-6 bg-[#FFFFFF1A] p-6 sm:min-h-[180px] light:bg-[#F4F4F5] lg:min-h-[280px]";

export function Testimonials({ workspace = "coding" }: { workspace?: "coding" | "design" }) {
  const design = workspace === "design";
  return (
    <Section id="testimonials" className="py-20">
      {design ? <Title lead="Design notes">from the canvas</Title> : <Title lead="How developers work">with Carbon</Title>}
      <div className="mt-12 grid gap-px sm:grid-cols-2 lg:mt-20 lg:grid-cols-4">
        {REVIEWS_AND_STATS.map((card) =>
          card.kind === "statistic" ? (
            <figure key={card.label} className={cardClass}>
              <span className="text-[56px] leading-none font-light tracking-[-0.06em]">{card.value}</span>
              <figcaption className="text-[17px] leading-6 tracking-[-0.01em]">{card.label}</figcaption>
            </figure>
          ) : (
            <article key={card.name} className={cardClass}>
              <blockquote className="text-[17px] leading-6 tracking-[-0.01em]">{design ? card.designText ?? card.text : card.text}</blockquote>
              <span className="flex items-center gap-2.5">
                <img src={card.avatar} alt="" width={28} height={28} loading="lazy" className="size-7 shrink-0 rounded-full object-cover" />
                <span className="truncate text-[13px] leading-4 text-[#8A8A8A] light:text-[#6B6B6B]">{card.name}</span>
              </span>
            </article>
          )
        )}
      </div>
      <p className="mt-3 text-[13px] text-[#8A8A8A] light:text-[#6B6B6B]">
        {design ? "The three design stories and the figures are illustrative." : "Figures are illustrative."}
      </p>
    </Section>
  );
}
