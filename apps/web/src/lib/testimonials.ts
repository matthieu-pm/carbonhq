export type Testimonial = {
  name: string;
  text: string;
  avatar: string;
  kind: "real" | "sample";
};

export const TESTIMONIALS: Testimonial[] = [
  {
    name: "Lucas Huang",
    avatar: "/avatars/lucas-huang.jpg",
    text: "I can atest it’s a game changer",
    kind: "real",
  },
  {
    name: "Maya Chen",
    avatar: "/avatars/sample-maya.jpg",
    kind: "sample",
    text: "Having Claude Code and Codex in the same app makes switching between them effortless.",
  },
  {
    name: "Noah Bennett",
    avatar: "/avatars/sample-noah.jpg",
    kind: "sample",
    text: "The interface stays out of the way. I spend more time building and less time managing terminals.",
  },
  {
    name: "Lena Fischer",
    avatar: "/avatars/sample-lena.jpg",
    kind: "sample",
    text: "Separate worktrees give me the confidence to run a few ideas in parallel.",
  },
  {
    name: "Sam Rivera",
    avatar: "/avatars/sample-sam.jpg",
    kind: "sample",
    text: "Reviewing the changes beside the conversation makes the whole workflow feel connected.",
  },
  {
    name: "Priya Shah",
    avatar: "/avatars/sample-priya.jpg",
    kind: "sample",
    text: "I started with one small fix. Now Carbon is where I open every project.",
  },
  {
    name: "Theo Martin",
    avatar: "/avatars/sample-theo.jpg",
    kind: "sample",
    text: "The little details add up. It feels like an app built by someone who uses coding agents all day.",
  },
  {
    name: "Jules Laurent",
    avatar: "/avatars/sample-jules.jpg",
    kind: "sample",
    text: "I can step away, come back, and quickly see which tasks need my attention.",
  },
];
