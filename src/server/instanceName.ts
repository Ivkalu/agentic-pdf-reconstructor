const ADJECTIVES = [
  "Sneaky", "Wobbly", "Grumpy", "Sparkly", "Dizzy",
  "Fluffy", "Chunky", "Bouncy", "Sleepy", "Spicy",
  "Crispy", "Funky", "Jazzy", "Zesty", "Mighty",
  "Turbo", "Cosmic", "Radical", "Groovy", "Epic",
  "Chonky", "Sassy", "Peppy", "Zippy", "Snazzy",
  "Wacky", "Breezy", "Quirky", "Jolly", "Nifty",
];

const NOUNS = [
  "Penguin", "Taco", "Waffle", "Narwhal", "Platypus",
  "Noodle", "Pickle", "Muffin", "Llama", "Potato",
  "Toaster", "Cactus", "Baguette", "Walrus", "Dumplin",
  "Avocado", "Panda", "Burrito", "Pretzel", "Hamster",
  "Capybara", "Raccoon", "Pancake", "Nugget", "Turnip",
  "Corgi", "Quokka", "Dumpling", "Puffin", "Donut",
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Generated once per process — stays the same for the container's lifetime */
export const INSTANCE_NAME = `${pick(ADJECTIVES)} ${pick(NOUNS)}`;
export const INSTANCE_STARTED_AT = new Date().toISOString();
