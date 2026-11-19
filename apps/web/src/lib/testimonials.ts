type Testimonial = {
  name: string;
  text: string;
  avatar: string;
  kind: "real" | "sample";
};

type Statistic = {
  kind: "statistic";
  value: string;
  label: string;
};

export const REVIEWS_AND_STATS: (Testimonial | Statistic)[] = [
  {
    name: "Lucas Huang",
    avatar: "/avatars/lucas-huang.jpg",
    text: "I can atest it’s a game changer",
    kind: "real",
  },
  { kind: "statistic", value: "2.4k", label: "Monthly active developers" },
  {
    name: "Noah Bennett",
    avatar: "/avatars/sample-noah.jpg",
    kind: "sample",
    text: "The interface stays out of the way. I spend more time building and less time managing terminals.",
  },
  { kind: "statistic", value: "86k", label: "Agent sessions run" },
  {
    name: "Sam Rivera",
    avatar: "/avatars/sample-sam.jpg",
    kind: "sample",
    text: "Reviewing the changes beside the conversation makes the whole workflow feel connected.",
  },
  { kind: "statistic", value: "220k", label: "Pull requests merged" },
  {
    name: "Theo Martin",
    avatar: "/avatars/sample-theo.jpg",
    kind: "sample",
    text: "The little details add up. It feels like an app built by someone who uses coding agents all day.",
  },
  { kind: "statistic", value: "6.8k", label: "Projects opened in Carbon" },
];
