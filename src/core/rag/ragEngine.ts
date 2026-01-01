import { App, TFile } from 'obsidian' // <--- 1. ¡IMPORTANTE! Agregado TFile

import { QueryProgressState } from '../../components/chat-view/QueryProgress'
import { VectorManager } from '../../database/modules/vector/VectorManager'
import { SelectEmbedding } from '../../database/schema'
import { SmartComposerSettings } from '../../settings/schema/setting.types'
import { EmbeddingModelClient } from '../../types/embedding'

import { getEmbeddingModelClient } from './embedding'

export class RAGEngine {
  private app: App
  private settings: SmartComposerSettings
  private vectorManager: VectorManager | null = null
  private embeddingModel: EmbeddingModelClient | null = null

  constructor(
    app: App,
    settings: SmartComposerSettings,
    vectorManager: VectorManager,
  ) {
    this.app = app
    this.settings = settings
    this.vectorManager = vectorManager
    this.embeddingModel = getEmbeddingModelClient({
      settings,
      embeddingModelId: settings.embeddingModelId,
    })
  }

  cleanup() {
    this.embeddingModel = null
    this.vectorManager = null
  }

  setSettings(settings: SmartComposerSettings) {
    this.settings = settings
    this.embeddingModel = getEmbeddingModelClient({
      settings,
      embeddingModelId: settings.embeddingModelId,
    })
  }

  async updateVaultIndex(
    options: { reindexAll: boolean } = { reindexAll: false },
    onQueryProgressChange?: (queryProgress: QueryProgressState) => void,
  ): Promise<void> {
    // Método neutralizado o mantenido por compatibilidad, pero no lo usamos activamente
    if (!this.embeddingModel) {
      throw new Error('Embedding model is not set')
    }
  }

// --- INICIO DEL INJERTO CORA (VERSIÓN HÍBRIDA: LOCAL + GRAFO) ---
 async processQuery({
    query,
    scope,
    onQueryProgressChange,
  }: {
    query: string
    scope?: {
      files: string[]
      folders: string[]
    }
    onQueryProgressChange?: (queryProgress: QueryProgressState) => void
  }): Promise<
    (Omit<SelectEmbedding, 'embedding'> & {
      similarity: number
    })[]
  > {
    
    // 1. ESTRATEGIA LOCAL (Chat normal con @Archivo)
    if (scope && scope.files && scope.files.length > 0) {
        // ... (Mismo código de lectura local que ya funcionaba) ...
        // (Te lo resumo aquí para no ocupar espacio, déjalo igual)
        const localResults: any[] = [];
        for (const filePath of scope.files) {
             const file = this.app.vault.getAbstractFileByPath(filePath);
             if (file instanceof TFile) {
                const content = await this.app.vault.read(file);
                localResults.push({
                    id: -1,
                    model: 'local-file',
                    path: filePath,
                    content: content,
                    similarity: 1.0,
                    mtime: file.stat.mtime,
                    metadata: { startLine: 0, endLine: 0, fileName: file.name, content: content }
                });
             }
        }
        onQueryProgressChange?.({ type: 'querying-done', queryResult: [] });
        return localResults;
    }

    // 2. ESTRATEGIA GLOBAL (Vault Chat -> LightRAG)
    console.log("🕸️ [Cora Plugin] Consultando LightRAG Server...");
    onQueryProgressChange?.({ type: 'querying' })

try {
      // 1. LLAMADA AL SERVIDOR
      const response = await fetch("http://localhost:9621/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
            query: query, 
            mode: "hybrid", 
            stream: false,
            only_need_context: false
        })
      });

      if (!response.ok) throw new Error(`Error LightRAG: ${response.status}`);

      const data = await response.json();
      console.log("✅ [Cora Plugin] Datos recibidos:", data);

      const results: any[] = [];

      // A. LA RESPUESTA GENERADA (Lo más importante)
      const graphAnswer = typeof data === 'string' ? data : (data.response || "");
      
      if (graphAnswer) {
          results.push({
              id: -1,
              model: 'lightrag-answer',
              path: "❤️ Respuesta de Cora (Grafo)",
              content: graphAnswer,
              similarity: 1.0,
              mtime: Date.now(),
              metadata: { startLine: 0, endLine: 0, fileName: "GraphAnswer", content: graphAnswer }
          });
      }

      // B. LAS REFERENCIAS (Solo Títulos/Rutas)
      // No leemos el contenido del disco. Solo listamos los archivos.
      if (data.references && Array.isArray(data.references)) {
          
          // Opcional: Crear un solo documento que liste todas las fuentes para ahorrar espacio visual
          // O crear uno por cada archivo (como pediste). Hagamos uno por archivo para que se vea la lista.
          
          for (let i = 0; i < data.references.length; i++) {
              const ref = data.references[i];
              const filePath = ref.file_path || `Ref #${i+1}`;
              
              results.push({
                  id: -(i + 2), // IDs únicos negativos
                  model: 'lightrag-ref',
                  path: `📂 ${filePath}`, // Esto es lo que verás en la lista
                  // Contenido mínimo para que el plugin no falle, pero sin gastar tokens
                  content: `[Fuente utilizada por el Grafo: ${filePath}]`, 
                  similarity: 0.5, // Menor relevancia que la respuesta principal
                  mtime: Date.now(),
                  metadata: { startLine: 0, endLine: 0, fileName: filePath }
              });
          }
      }

      onQueryProgressChange?.({ type: 'querying-done', queryResult: [] })
      return results;

    } catch (error) {
        console.error("❌ Error:", error);
        return [];
    }
  }
  // --- FIN DEL INJERTO CORA ---

  private async getQueryEmbedding(query: string): Promise<number[]> {
    if (!this.embeddingModel) {
      throw new Error('Embedding model is not set')
    }
    return this.embeddingModel.getEmbedding(query)
  }
}