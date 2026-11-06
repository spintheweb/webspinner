import { MongoClient } from "mongodb";
class STWMongoAdapter {
	constructor(config) {
		this.config = config;
		this.client = new MongoClient(this.config.uri);
	}
	client;
	db;
	async connect() {
		await this.client.connect();
		this.db = this.client.db(this.config.database);
	}
	async close() {
		await this.client.close();
	}
	/**
    * List all collections in the database
    */
	async listObjects() {
		const collections = await this.db.listCollections().toArray();
		const fields = ["name"];
		const rows = collections.map((col) => ({ name: col.name }));
		return {
			affectedRows: rows.length,
			fields,
			rows
		};
	}
	/**
    * Get details (fields) for a collection (sample document keys)
    * @param collectionName Name of the collection
    */
	async getObjectDetails(collectionName) {
		const collection = this.db.collection(collectionName);
		const doc = await collection.findOne();
		const fields = ["name", "type"];
		const rows = doc ? Object.keys(doc).map((name) => ({ name, type: typeof doc[name] })) : [];
		return {
			affectedRows: rows.length,
			fields,
			rows
		};
	}
	/**
    * Execute a batch of MongoDB commands (semicolon-separated JSON objects)
    * Supported: find, insert, update, delete
    */
	async execute(batch) {
		const commands = batch.split(";").map((cmd) => cmd.trim()).filter((cmd) => cmd);
		const results = [];
		for (const cmd of commands) {
			let result;
			try {
				const obj = JSON.parse(cmd);
				const collection = this.db.collection(obj.collection || this.config.collection);
				if (obj.find) {
					const docs = await collection.find(obj.find).toArray();
					const fields = docs.length > 0 ? Object.keys(docs[0]) : [];
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
				result = { affectedRows: 0, fields: [], rows: [{ error: e.message }] };
			}
			results.push(result);
		}
		return results;
	}
}
export {
	STWMongoAdapter
};
