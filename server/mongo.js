import { MongoClient } from "mongodb";
import { randomUUID } from "node:crypto";

export async function createMongoAuthStore(
  uri,
  dbName = process.env.MONGODB_DB_NAME || "careerflow",
) {
  const client = new MongoClient(uri, {
    maxPoolSize: 10,
    minPoolSize: 1,
    serverSelectionTimeoutMS: 8000,
  });

  await client.connect();
  const db = client.db(dbName);
  const usersCollection = db.collection("users");
  const sessionsCollection = db.collection("sessions");

  // Create necessary unique and TTL indexes
  try {
    await usersCollection.createIndex({ email: 1 }, { unique: true });
    await sessionsCollection.createIndex({ token_hash: 1 }, { unique: true });
    await sessionsCollection.createIndex(
      { expires_at: 1 },
      { expireAfterSeconds: 0 },
    );
    await sessionsCollection.createIndex({ user_id: 1 });
  } catch (err) {
    console.warn("Notice: MongoDB index initialization:", err.message);
  }

  const createUser = async ({
    id,
    email,
    name,
    passwordHash,
    role = "user",
  }) => {
    const current = new Date().toISOString();
    const user = {
      id: id || randomUUID(),
      email: email.toLowerCase().trim(),
      name: name.trim(),
      password_hash: passwordHash,
      role,
      created_at: current,
      updated_at: current,
    };
    await usersCollection.insertOne({ ...user });
    return user;
  };

  const getUserByEmail = async (email) => {
    if (!email) return null;
    return (
      (await usersCollection.findOne({
        email: email.toLowerCase().trim(),
      })) || null
    );
  };

  const getUserById = async (id) => {
    if (!id) return null;
    return (await usersCollection.findOne({ id })) || null;
  };

  const countUsers = async () => {
    return await usersCollection.countDocuments();
  };

  const createSession = async ({ id, userId, tokenHash, expiresAt }) => {
    const current = new Date();
    const expiryDate =
      expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
    const session = {
      id: id || randomUUID(),
      user_id: userId,
      token_hash: tokenHash,
      expires_at: expiryDate,
      created_at: current.toISOString(),
      last_active_at: current.toISOString(),
    };
    await sessionsCollection.insertOne({ ...session });
    return {
      ...session,
      expires_at: expiryDate.toISOString(),
    };
  };

  const getSessionByTokenHash = async (tokenHash) => {
    if (!tokenHash) return null;
    const session = await sessionsCollection.findOne({ token_hash: tokenHash });
    if (!session) return null;

    // Normalize expires_at
    const expiry =
      session.expires_at instanceof Date
        ? session.expires_at
        : new Date(session.expires_at);

    if (expiry.getTime() <= Date.now()) {
      await sessionsCollection.deleteOne({ _id: session._id });
      return null;
    }

    const user = await usersCollection.findOne({ id: session.user_id });
    if (!user) return null;

    return {
      id: session.id,
      user_id: session.user_id,
      token_hash: session.token_hash,
      expires_at: expiry.toISOString(),
      created_at: session.created_at,
      last_active_at: session.last_active_at,
      user_email: user.email,
      user_name: user.name,
      user_role: user.role || "user",
      user_created_at: user.created_at,
    };
  };

  const touchSession = async (sessionId) => {
    const current = new Date().toISOString();
    await sessionsCollection.updateOne(
      { id: sessionId },
      { $set: { last_active_at: current } },
    );
  };

  const deleteSession = async (sessionId) => {
    await sessionsCollection.deleteOne({ id: sessionId });
  };

  const deleteSessionByTokenHash = async (tokenHash) => {
    await sessionsCollection.deleteOne({ token_hash: tokenHash });
  };

  const deleteUserSessions = async (userId) => {
    await sessionsCollection.deleteMany({ user_id: userId });
  };

  const cleanExpiredSessions = async () => {
    await sessionsCollection.deleteMany({
      expires_at: { $lte: new Date() },
    });
  };

  const close = async () => {
    await client.close();
  };

  return {
    client,
    db,
    isMongo: true,
    createUser,
    getUserByEmail,
    getUserById,
    countUsers,
    createSession,
    getSessionByTokenHash,
    touchSession,
    deleteSession,
    deleteSessionByTokenHash,
    deleteUserSessions,
    cleanExpiredSessions,
    close,
  };
}
