#!/usr/bin/env python3
"""PROMETHEUS ChromaDB Server — episodic memory backend"""
import os, json
import chromadb
from flask import Flask, request, jsonify

app = Flask(__name__)
DB_PATH = os.path.expanduser('~/claude-relay/knowledge/chromadb')
os.makedirs(DB_PATH, exist_ok=True)

client = chromadb.PersistentClient(path=DB_PATH)
collection = client.get_or_create_collection(
    name='prometheus_episodes',
    metadata={'hnsw:space': 'cosine'}
)

@app.route('/health')
def health():
    return jsonify({'ok': True, 'count': collection.count()})

@app.route('/count')
def count():
    return jsonify({'count': collection.count()})

@app.route('/add', methods=['POST'])
def add():
    d = request.json
    try:
        collection.add(
            documents=[d['text']],
            metadatas=[d.get('metadata', {})],
            ids=[d['id']],
        )
        return jsonify({'ok': True, 'id': d['id']})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 400

@app.route('/search', methods=['POST'])
def search():
    d = request.json
    try:
        results = collection.query(
            query_texts=[d['query']],
            n_results=d.get('n', 5),
            where=d.get('filter') if d.get('filter') else None,
        )
        return jsonify(results)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    print(f'[ChromaDB] Starting on :8765 — {collection.count()} episodes')
    app.run(port=8765, debug=False, host='127.0.0.1')
