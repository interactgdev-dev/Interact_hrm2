import { MongoClient, Db, Document } from "mongodb";

declare global {
  // eslint-disable-next-line no-var
  var __interactMongoClient: MongoClient | undefined;
  // eslint-disable-next-line no-var
  var __interactMongoDb: Db | undefined;
}

export function getMongoUri(): string {
  return (
    process.env.MONGO_URI ||
    process.env.MONGODB_URI ||
    "mongodb://127.0.0.1:27017"
  );
}

export function getMongoDbName(): string {
  return process.env.MONGO_DB || process.env.DB_NAME || "interact_hrm";
}

export async function getMongoDb(): Promise<Db> {
  if (global.__interactMongoDb) return global.__interactMongoDb;

  const uri = getMongoUri();
  const client =
    global.__interactMongoClient ||
    new MongoClient(uri, {
      maxPoolSize: 20,
    });

  if (!global.__interactMongoClient) {
    await client.connect();
    global.__interactMongoClient = client;
  }

  const db = client.db(getMongoDbName());
  global.__interactMongoDb = db;
  return db;
}

export async function mongoCollection<T extends Document = Document>(name: string) {
  const db = await getMongoDb();
  return db.collection<T>(name);
}
