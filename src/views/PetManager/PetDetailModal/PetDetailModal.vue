<script setup lang="ts">
/**
 * PetDetailModal 组件：桌面宠物详情弹窗，展示预览、动画与下载/使用。
 *
 * 布局：左预览 + 右信息（标题行含操作按钮），左右独立高度不互相撑开。
 */
import { useDetailModal, type PetDetailModalEmits, type PetDetailModalProps } from './usePetDetailModal'
import PetPreview from '../PetPreview/PetPreview.vue'
import PetThumb from '../PetThumb/PetThumb.vue'

const props = withDefaults(defineProps<PetDetailModalProps>(), {
  isActive: false
})
const emit = defineEmits<PetDetailModalEmits>()

const {
  animRows,
  activeAction,
  canUse,
  canDownload,
  close,
  handleDownload,
  handleUse,
  playAnim
} = useDetailModal(props, emit as never)
</script>

<template>
  <n-modal
    :show="visible"
    @update:show="emit('update:visible', $event)"
  >
    <div
      v-if="pet"
      class="pet-detail"
    >
      <!-- 左侧：大图实时预览（高度自适应，不被右侧撑高） -->
      <div class="pet-detail__stage">
        <PetPreview
          :pet-id="pet.id"
          :spritesheet-src="pet.spritesheetSrc"
          :scale="1.1"
          :active-action="activeAction"
        />
      </div>

      <!-- 右侧：信息区（独立滚动） -->
      <div class="pet-detail__side">
        <!-- 标题行：名称 + 标签 + 操作按钮（一行内） -->
        <div class="pet-detail__topbar">
          <div class="pet-detail__title-group">
            <h3 class="pet-detail__name">{{ pet.displayName }}</h3>
            <div class="pet-detail__meta">
              <span
                v-if="pet.kind"
                class="pet-detail__kind"
              >{{ pet.kind }}</span>
              <span
                v-if="pet.source === 'builtin'"
                class="pet-detail__badge"
              >内置</span>
              <span
                v-else-if="pet.source === 'downloaded'"
                class="pet-detail__badge pet-detail__badge--muted"
              >已安装</span>
            </div>
          </div>

          <!-- 操作按钮直接放在标题旁边 -->
          <div class="pet-detail__top-actions">
            <n-button
              v-if="canDownload"
              size="small"
              type="primary"
              @click="handleDownload"
            >
              下载并使用
            </n-button>
            <n-button
              v-else-if="canUse"
              size="small"
              type="primary"
              @click="handleUse"
            >
              设为当前
            </n-button>
            <span
              v-else
              class="pet-detail__current"
            >使用中</span>
            <n-button
              size="small"
              quaternary
              @click="close"
            >
              关闭
            </n-button>
          </div>
        </div>

        <p
          v-if="pet.description"
          class="pet-detail__desc"
        >
          {{ pet.description }}
        </p>

        <div
          v-if="pet.tags && pet.tags.length"
          class="pet-detail__tags"
        >
          <span
            v-for="tag in pet.tags"
            :key="tag"
            class="pet-detail__tag"
          >{{ tag }}</span>
        </div>

        <!-- 动画状态 -->
        <div class="pet-detail__anims">
          <p class="pet-detail__anims-title">动画状态（点击预览）</p>
          <div class="pet-detail__anims-grid">
            <button
              v-for="row in animRows"
              :key="row.id"
              type="button"
              class="anim-cell"
              :class="{ 'anim-cell--active': activeAction === row.id }"
              @click="playAnim(row.id)"
            >
              <PetThumb
                :src="pet.spritesheetSrc"
                :row="row.index"
                :col="0"
                :lazy="false"
              />
              <span class="anim-cell__label">{{ row.id }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </n-modal>
</template>
<style scoped src="./styles.css"></style>
