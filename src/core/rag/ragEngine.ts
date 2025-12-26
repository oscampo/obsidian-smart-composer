import { App } from 'obsidian'

import { QueryProgressState } from '../../components/chat-view/QueryProgress'
import { VectorManager } from '../../database/modules/vector/VectorManager'
import { SelectEmbedding } from '../../database/schema'
import { SmartComposerSettings } from '../../settings/schema/setting.types'
import { EmbeddingModelClient } from '../../types/embedding'

import { getEmbeddingModelClient } from './embedding'

// TODO: do we really need this class? It seems like unnecessary abstraction.
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

  // TODO: use addSettingsChangeListener
  setSettings(settings: SmartComposerSettings) {
    this.settings = settings
    this.embeddingModel = getEmbeddingModelClient({
      settings,
      embeddingModelId: settings.embeddingModelId,
    })
  }

  // TODO: Implement automatic vault re-indexing when settings are changed.
  // Currently, users must manually re-index the vault.
  async updateVaultIndex(
    options: { reindexAll: boolean } = {
      reindexAll: false,
    },
    onQueryProgressChange?: (queryProgress: QueryProgressState) => void,
  ): Promise<void> {
    if (!this.embeddingModel) {
      throw new Error('Embedding model is not set')
    }
    await this.vectorManager?.updateVaultIndex(
      this.embeddingModel,
      {
        chunkSize: this.settings.ragOptions.chunkSize,
        excludePatterns: this.settings.ragOptions.excludePatterns,
        includePatterns: this.settings.ragOptions.includePatterns,
        reindexAll: options.reindexAll,
      },
      (indexProgress) => {
        onQueryProgressChange?.({
          type: 'indexing',
          indexProgress,
        })
      },
    )
  }

// --- INICIO DEL INJERTO CORA ---
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
    console.log("🕸️ [Cora Mod] Interceptando búsqueda. Redirigiendo a LightRAG...");
    
    onQueryProgressChange?.({ type: 'querying' })

    try {
      // 1. Llamar a TU API en Python (Backend Local)
      const response = await fetch("http://127.0.0.1:8000/query_lightrag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
            query: query, 
            mode: "hybrid" // Usamos el modo más potente
        })
      });

      if (!response.ok) {
        throw new Error(`Error del Backend Cora: ${response.statusText}`);
      }

      const data = await response.json();
      const lightRagAnswer = data.response; // La respuesta generada por el grafo

      console.log("✅ [Cora Mod] Respuesta recibida del Grafo.");

      onQueryProgressChange?.({ 
          type: 'querying-done', 
          queryResult: [] // Hack visual para que deje de cargar
      })

      // 2. EL TRUCO DE MAGIA (VERSIÓN 3.0 - STRICT TYPE)
      const fakeDoc: any = {
          id: -1,
          path: "🧠 Memoria del Grafo",
          content: lightRagAnswer,
          similarity: 1.0,
          metadata: { startLine: 0, endLine: 0 }
      };
      return [fakeDoc];

    } catch (error) {
      console.error("❌ [Cora Mod] Error conectando con Python:", error);
      // Fallback: Si el servidor está apagado, devolvemos lista vacía
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
