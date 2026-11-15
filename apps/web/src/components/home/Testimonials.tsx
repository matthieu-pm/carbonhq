import { Section, Title } from "@/components/home/Section";
import { TESTIMONIALS } from "@/lib/testimonials";

export function Testimonials() {
  return (
    <Section id="testimonials" className="py-20">
      <Title lead="Reviews.">
        Different ways to work with Carbon.
      </Title>
      <div className="mt-12 grid gap-px sm:grid-cols-2 lg:mt-20 lg:grid-cols-4">
        {TESTIMONIALS.map((t) => (
          <article
            key={t.name}
            className="flex min-h-[140px] flex-col sm:min-h-[180px] justify-between gap-6 bg-[#FFFFFF1A] p-6 light:bg-[#F4F4F5] lg:min-h-[280px]"
          >
            <blockquote className="text-[17px] leading-6 tracking-[-0.01em] text-white light:text-[#0A0A0A]">{t.text}</blockquote>
            <span className="flex items-center gap-2.5">
              <img src={t.avatar} alt="" width={28} height={28} loading="lazy" className="size-7 shrink-0 rounded-full object-cover" />
              <span className="truncate text-[13px] leading-4 text-[#8A8A8A] light:text-[#6B6B6B]">{t.name}</span>
            </span>
          </article>
        ))}
      </div>
    </Section>
  );
}
