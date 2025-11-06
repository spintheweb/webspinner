// SPDX-License-Identifier: GPL-3.0-or-later
// MongoDB adapter for Spin the Web

import { MongoClient } from "npm:mongodb";
import { ISTWAdapter, ISTWRecords } from "./adapter.ts";

export class STWMongoAdapter implements ISTWAdapter {
  private client: MongoClient;
  private db: any;

  constructor(private config: {
    uri: string;
    database: string;
    collection: string;
  }) {
    this.client = new MongoClient(this.config.uri);
  }

  async connect(): Promise<void> {
    await this.client.connect();
    this.db = this.client.db(this.config.database);
  }

  async close(): Promise<void> {
    await this.client.close();
  }

  /**
   * List all collections in the database
   */
  async listObjects(): Promise<ISTWRecords> {
    const collections = await this.db.listCollections().toArray();
    const fields = [{ name: "name", type: "string" }];
    const rows = collections.map((col: any) => ({ name: col.name }));
    return {
      affectedRows: rows.length,
      fields,
      rows,
    };
  }

  /**
   * Get details (fields) for a collection (sample document keys)
   * @param collectionName Name of the collection
   */
  async getObjectDetails(collectionName: string): Promise<ISTWRecords> {
    const collection = this.db.collection(collectionName);
    const doc = await collection.findOne();
    const fields = doc ? Object.keys(doc).map(k => ({ name: k, type: typeof doc[k] })) : [];
    return {
      affectedRows: fields.length,
      fields,
      rows: fields,
    };
  }

  /**
   * Execute a batch of MongoDB commands (semicolon-separated JSON objects)
   * Supported: find, insert, update, delete
   */
  async execute(batch: string): Promise<ISTWRecords[]> {
    // For MongoDB, treat batch as a set of JSON commands
    const commands = batch.split(';').map(cmd => cmd.trim()).filter(cmd => cmd);
    const results: ISTWRecords[] = [];
    for (const cmd of commands) {
      let result: ISTWRecords | null = null;
      try {
        const obj = JSON.parse(cmd);
        const collection = this.db.collection(obj.collection || this.config.collection);
        if (obj.find) {
          const docs = await collection.find(obj.find).toArray();
          const fields = docs.length > 0 ? Object.keys(docs[0]).map(k => ({ name: k, type: typeof docs[0][k] })) : [];
          result = { affectedRows: docs.length, fields, rows: docs };
        } else if (obj.insert) {
          const res = await collection.insertOne(obj.insert);
          result = { affectedRows: res ? 1 : 0, fields: [], rows: [res] };
        } else if (obj.update) {
          const res = await collection.updateOne(obj.update.filter, obj.update.update);
          result = { affectedRows: res.modifiedCount, fields: [], rows: [res] };
        } else if (obj.delete) {
          const res = await collection.deleteOne(obj.delete);
          result = { affectedRows: res.deletedCount, fields: [], rows: [res] };
        } else {
          result = { affectedRows: 0, fields: [], rows: [] };
        }
      } catch (e) {
        result = { affectedRows: 0, fields: [], rows: [{ error: (e as Error).message }] };
      }
      results.push(result);
    }
    return results;
  }
}
