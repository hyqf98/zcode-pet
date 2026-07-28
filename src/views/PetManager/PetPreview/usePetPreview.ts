import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { createPetApp } from '@/modules/desktopPet/engine'
import type { PetApp } from '@/modules/desktopPet/engine'
import { fetchRemoteSpritesheetUrl } from '@/services/desktopPet'

/**
 * 宠物实时预览（PixiJS）。
 *
 * 精灵图来源处理：
 *   - 本地已安装宠物：convertFileSrc 产出的 `http://asset.localhost/.../spritesheet.webp`，直接用。
 *   - 远程市场宠物（https://codex-pets.net）：前端因 CORS 无法直接加载，
 *     通过 Rust 后端 `fetch_remote_spritesheet` 下载到本地缓存（pets_cache），
 *     返回 convertFileSrc URL（带 .webp 扩展名），PixiJS Assets.load 可正常加载。
 *
 * 行为：
 *   - spritesheetSrc / petId 变化 → switchPet（不重建引擎）。
 *   - scale 变化 → 重建引擎。
 *   - activeAction 变化 → playAction。
 *   - 卸载 → destroy 释放纹理。
 */
export interface PetPreviewProps {
  /** 宠物 id（用于后端缓存目录命名）。 */
  petId: string
  /** 精灵图源（本地 convertFileSrc 或远程 https）。 */
  spritesheetSrc: string
  /** 宠物缩放（相对 192x208 单元），默认 0.9。 */
  scale?: number
  /** 当前手动触发的动作 id（如 'waving'）；为空则自动漫游。 */
  activeAction?: string
}

export function usePetPreview(props: PetPreviewProps) {
  const hostRef = ref<HTMLElement | null>(null)
  const petApp = ref<PetApp | null>(null)
  const loadError = ref<string | null>(null)
  const isLoading = ref(true)

  /**
   * 解析精灵图源为可加载的本地 URL。
   *
   * - 本地（asset 协议 / tauri:// / blob:）→ 直接用。
   *   注意：macOS 上 convertFileSrc 产出 `asset://localhost/...`（无点号），
   *   不能用 `includes('asset.localhost')` 判断，要用 `asset://` 协议头。
   * - 远程 https → 调 Rust 后端下载到本地缓存，返回 convertFileSrc URL。
   */
  async function resolveSrc(src: string): Promise<string> {
    // 本地资源 → 直接用。
    if (
      src.startsWith('blob:') ||
      src.startsWith('asset://') ||
      src.startsWith('http://asset.localhost') ||
      src.startsWith('https://asset.localhost') ||
      src.startsWith('tauri://')
    ) {
      return src
    }

    // 远程 https → Rust 后端代理下载（绕过 CORS）。
    try {
      return await fetchRemoteSpritesheetUrl(props.petId, src)
    } catch (e) {
      console.error('[PetPreview] backend fetch remote spritesheet failed:', e)
      throw e
    }
  }

  async function bootApp(): Promise<void> {
    if (!hostRef.value) return
    await destroyApp()
    isLoading.value = true
    loadError.value = null
    try {
      const resolvedSrc = await resolveSrc(props.spritesheetSrc)
      petApp.value = await createPetApp(hostRef.value, {
        initialPetId: props.petId,
        initialSpritesheetSrc: resolvedSrc,
        config: { scale: props.scale ?? 0.9 },
        preview: true
      })
      isLoading.value = false
    } catch (error) {
      console.error('[PetPreview] boot failed:', error)
      loadError.value = error instanceof Error ? error.message : String(error)
      isLoading.value = false
    }
  }

  async function destroyApp(): Promise<void> {
    if (petApp.value) {
      try {
        await petApp.value.destroy()
      } catch (error) {
        console.error('[PetPreview] destroy failed:', error)
      }
      petApp.value = null
    }
  }

  onMounted(() => {
    void bootApp()
  })

  // src / petId 变化：切换宠物。
  watch(
    () => [props.spritesheetSrc, props.petId] as const,
    async ([src, id]) => {
      if (!petApp.value) return
      if (id === petApp.value.currentPetId) return
      isLoading.value = true
      try {
        const resolvedSrc = await resolveSrc(src)
        await petApp.value.switchPet(id, resolvedSrc)
        isLoading.value = false
      } catch (error) {
        console.error('[PetPreview] switch failed:', error)
        loadError.value = error instanceof Error ? error.message : String(error)
        isLoading.value = false
      }
    }
  )

  // scale 变化：重建引擎。
  watch(
    () => props.scale ?? 0.9,
    () => {
      void bootApp()
    }
  )

  // activeAction 变化：触发动作。
  watch(
    () => props.activeAction,
    (action) => {
      if (petApp.value && action) {
        petApp.value.playAction(action)
      }
    }
  )

  onBeforeUnmount(() => {
    void destroyApp()
  })

  return {
    hostRef,
    isLoading,
    loadError
  }
}
