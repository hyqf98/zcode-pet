/** usePetDetailModal — 桌面宠物详情弹窗组件的 composable。 */
import { computed, ref, watch } from 'vue'
import { CODEX_ATLAS_ROWS_DEF } from '@/modules/desktopPet/engine'

/**
 * 宠物详情弹窗：大图实时预览 + 9 个动画状态切换 + 下载/使用操作。
 *
 * pet.spritesheetSrc 既可能是本地 convertFileSrc（已安装宠物）也可能是远程 https（市场宠物），
 * PetPreview 两种都支持。点击某行动画按钮 → 设置 activeAction → 大图实时播放该动画。
 */

/** 详情用统一宠物结构（兼容本地 LocalPetInfo 与远程 CodexPetSummary）。 */
export interface DetailPet {
  id: string
  displayName: string
  description?: string | null
  kind?: string | null
  tags: string[]
  /** 精灵图源（本地 convertFileSrc 或远程 https）。 */
  spritesheetSrc: string
  /** 是否已本地安装。 */
  installed: boolean
  /** 来源标签：'builtin' | 'downloaded' | 'remote'。 */
  source: string
  /** 远程市场的下载数等可选元信息。 */
  downloadCount?: number | null
  viewCount?: number | null
  /** 安装时间（本地宠物可选）。 */
  installedAt?: string | null
}

export interface PetDetailModalProps {
  visible: boolean
  pet: DetailPet | null
  /** 是否为当前激活宠物（决定"设为当前"按钮状态）。 */
  isActive?: boolean
}

export interface PetDetailModalEmits {
  (event: 'update:visible', value: boolean): void
  (event: 'download', petId: string): void
  (event: 'use', petId: string): void
  (event: 'delete', petId: string): void
}

export function useDetailModal(
  props: PetDetailModalProps,
  emit: (event: 'update:visible' | 'download' | 'use' | 'delete', ...args: unknown[]) => void
) {
  // 当前正在播放的动画行 id（空 = 自动漫游）。
  const activeAction = ref<string>('')

  // 9 个动画行（idle/running-right/.../review）。
  const animRows = CODEX_ATLAS_ROWS_DEF

  const canUse = computed(() => props.pet?.installed && !props.isActive)
  const canDownload = computed(() => !props.pet?.installed)
  const canDelete = computed(
    () => props.pet?.installed && props.pet.source !== 'builtin'
  )

  function close(): void {
    emit('update:visible', false)
  }

  function handleDownload(): void {
    if (props.pet) {
      emit('download', props.pet.id)
    }
    close()
  }

  function handleUse(): void {
    if (props.pet) {
      emit('use', props.pet.id)
    }
    close()
  }

  function handleDelete(): void {
    if (props.pet) {
      emit('delete', props.pet.id)
    }
    close()
  }

  function playAnim(rowId: string): void {
    // 再次点击同一动画 → 取消（回到自动漫游）。
    activeAction.value = activeAction.value === rowId ? '' : rowId
  }

  // 弹窗打开时重置动画选择。
  watch(
    () => props.visible,
    (visible) => {
      if (visible) {
        activeAction.value = ''
      }
    }
  )

  return {
    animRows,
    activeAction,
    canUse,
    canDownload,
    canDelete,
    close,
    handleDownload,
    handleUse,
    handleDelete,
    playAnim
  }
}
