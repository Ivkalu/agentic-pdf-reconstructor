const CHARACTERS = [
  "Baltazar", "Hlapić", "Bundaš", "Čupko", "Reksio",
  "Lolek", "Bolek", "Čičak", "Koko", "Grizelda",
  "Fafica", "Šegrt", "Vuk", "Kiko", "Medo",
  "Lapitch", "Dudek", "Žubor", "Bubi", "Zeko",
  "Gašpar", "Melkior", "Baltić", "Štrumf", "Petar",
  "Zvončica", "Firga", "Pajo", "Čokolino", "Smogovci",
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Generated once per process — stays the same for the container's lifetime */
export const INSTANCE_NAME = pick(CHARACTERS);
export const INSTANCE_STARTED_AT = new Date().toISOString();
