<script setup lang="ts">
/**
 * PetManager 管理窗口主视图：宠物选择/查看/市场。
 * 按 taste-skills redesign 规范设计。
 */
import { usePetManager } from './index'
import PetThumb from './PetThumb/PetThumb.vue'
import PetDetailModal from './PetDetailModal/PetDetailModal.vue'

const {
  t,
  petSettings,
  desktopPetStore,
  sortOptions,
  kindOptions,
  languageOptions,
  scaleMin,
  scaleMax,
  scaleStep,
  activeSubTab,
  settingsOpen,
  updateInfo,
  handleDownloadUpdate,
  detailVisible,
  detailPet,
  zcodeLinked,
  zcodeToggling,
  handleToggleEnabled,
  openLocalDetail,
  openRemoteDetail,
  handleDetailDownload,
  handleDetailUse,
  handleSearchSubmit,
  handleFilterChange,
  handleQuickDownload,
  handleLanguageChange,
  handleScaleChange,
  handleToggleZCodeLink,
  toLocalAssetUrl
} = usePetManager()
</script>

<template>
  <main class="pet-manager">
    <!-- 顶部：标题 + 更新按钮 + 总开关 -->
    <header class="pm-header">
      <div class="pm-header__brand">
        <h1 class="pm-title">桌面宠物</h1>
        <p class="pm-subtitle">选一只陪伴你写代码的小家伙</p>
      </div>
      <div class="pm-header__actions">
        <!-- 有新版本时显示下载按钮 -->
        <button
          v-if="updateInfo.hasUpdate"
          type="button"
          class="pm-update-btn"
          :title="t('ui.update.tooltip', { version: updateInfo.latestVersion })"
          @click="handleDownloadUpdate"
        >
          <span class="pm-update-btn__dot" />
          {{ t('ui.update.available', { version: updateInfo.latestVersion }) }}
        </button>
        <label class="pm-power">
          <span class="pm-power__label">{{ petSettings.enabled ? '运行中' : '已关闭' }}</span>
          <n-switch
            :value="petSettings.enabled"
            :round="false"
            @update:value="handleToggleEnabled"
          />
        </label>
      </div>
    </header>

    <!-- 未开启引导条 -->
    <div
      v-if="!petSettings.enabled"
      class="pm-guide"
      role="status"
    >
      <div class="pm-guide__dot" />
      <span class="pm-guide__text">宠物已关闭，打开右上角开关即可在桌面显示。先选一只喜欢的吧。</span>
    </div>

    <!-- 运行中状态条 -->
    <div
      v-if="petSettings.enabled"
      class="pm-status-bar"
    >
      <div class="pm-status-bar__item">
        <span class="pm-status-bar__key">状态</span>
        <span class="pm-status-bar__val pm-status-bar__val--live">
          <i class="pm-live-dot" />运行中
        </span>
      </div>
      <div class="pm-status-bar__divider" />
      <div class="pm-status-bar__item">
        <span class="pm-status-bar__key">当前宠物</span>
        <span class="pm-status-bar__val">{{ desktopPetStore.activePet?.displayName ?? '未选择' }}</span>
      </div>
    </div>

    <!-- 设置区：语言 / 缩放 / ZCode 联动（可折叠，默认收起，释放垂直空间给宠物列表） -->
    <section class="pm-settings">
      <button
        type="button"
        class="pm-settings__toggle"
        :class="{ 'pm-settings__toggle--open': settingsOpen }"
        @click="settingsOpen = !settingsOpen"
      >
        <span class="pm-settings__toggle-text">{{ t('ui.settings.title') }}</span>
        <span class="pm-settings__toggle-summary">
          <span class="pm-settings__chip">{{ petSettings.scale }}%</span>
          <span
            class="pm-settings__chip pm-settings__chip--status"
            :class="{ 'pm-settings__chip--on': zcodeLinked }"
          >{{ zcodeLinked ? t('ui.zcode.linked') : t('ui.zcode.unlinked') }}</span>
        </span>
        <span class="pm-settings__chevron">⌄</span>
      </button>

      <div
        v-show="settingsOpen"
        class="pm-settings__body"
      >
        <!-- 语言 -->
        <div class="pm-setting">
          <div class="pm-setting__head">
            <span class="pm-setting__label">{{ t('ui.settings.language') }}</span>
          </div>
          <n-select
            :value="petSettings.locale"
            :options="languageOptions"
            class="pm-setting__control pm-setting__control--lang"
            @update:value="handleLanguageChange"
          />
        </div>

        <!-- 缩放 -->
        <div class="pm-setting">
          <div class="pm-setting__head">
            <span class="pm-setting__label">{{ t('ui.pet.scale') }}</span>
            <span class="pm-setting__value">{{ petSettings.scale }}%</span>
          </div>
          <n-slider
            :value="petSettings.scale"
            :min="scaleMin"
            :max="scaleMax"
            :step="scaleStep"
            :tooltip="false"
            class="pm-setting__control pm-setting__control--scale"
            @update:value="handleScaleChange"
          />
        </div>

        <!-- ZCode 联动 -->
        <div class="pm-setting pm-setting--wide">
          <div class="pm-setting__head">
            <span class="pm-setting__label">{{ t('ui.zcode.link') }}</span>
            <n-switch
              :value="zcodeLinked"
              :loading="zcodeToggling"
              :round="false"
              @update:value="handleToggleZCodeLink"
            />
          </div>
          <p class="pm-setting__hint">{{ t('ui.zcode.linkHint') }}</p>
        </div>
      </div>
    </section>

    <!-- tab 导航 -->
    <nav class="pm-tabs">
      <button
        type="button"
        class="pm-tab"
        :class="{ 'pm-tab--active': activeSubTab === 'local' }"
        @click="activeSubTab = 'local'"
      >
        我的宠物
        <span class="pm-tab__count">{{ desktopPetStore.localPets.length }}</span>
      </button>
      <button
        type="button"
        class="pm-tab"
        :class="{ 'pm-tab--active': activeSubTab === 'market' }"
        @click="activeSubTab = 'market'"
      >
        宠物市场
      </button>
    </nav>

    <!-- 我的宠物 -->
    <section
      v-if="activeSubTab === 'local'"
      class="pm-panel"
    >
      <div class="pm-list">
        <div
          v-if="desktopPetStore.localPets.length === 0"
          class="pm-empty"
        >
          还没有安装任何宠物，去市场看看吧
        </div>
        <div
          v-else
          class="pm-grid"
        >
          <article
            v-for="pet in desktopPetStore.localPets"
            :key="pet.id"
            class="pm-card"
            :class="{ 'pm-card--active': pet.id === desktopPetStore.activePetId }"
            @click="openLocalDetail(pet)"
          >
            <div class="pm-card__thumb">
              <PetThumb
                :src="toLocalAssetUrl(pet.spritesheetPath)"
                :row="0"
                :col="0"
              />
              <span
                v-if="pet.source === 'builtin'"
                class="pm-card__tag"
              >内置</span>
              <span
                v-if="pet.id === desktopPetStore.activePetId"
                class="pm-card__tag pm-card__tag--active"
              >使用中</span>
            </div>
            <div class="pm-card__body">
              <h3 class="pm-card__name">{{ pet.displayName }}</h3>
              <span
                v-if="pet.kind"
                class="pm-card__kind"
              >{{ pet.kind }}</span>
            </div>
          </article>
        </div>
      </div>
    </section>

    <!-- 宠物市场 -->
    <section
      v-else
      class="pm-panel"
    >
      <!-- 筛选栏（固定不滚） -->
      <div class="pm-filters">
        <n-input
          v-model:value="desktopPetStore.remoteQuery"
          placeholder="搜索宠物名称…"
          class="pm-filters__search"
          clearable
          @keydown.enter="handleSearchSubmit"
        />
        <n-select
          v-model:value="desktopPetStore.remoteKind"
          :options="kindOptions"
          class="pm-filters__select"
          @update:value="handleFilterChange"
        />
        <n-select
          v-model:value="desktopPetStore.remoteSort"
          :options="sortOptions"
          class="pm-filters__select"
          @update:value="handleFilterChange"
        />
        <n-button
          type="primary"
          :loading="desktopPetStore.remoteLoading"
          @click="handleSearchSubmit"
        >
          搜索
        </n-button>
      </div>

      <!-- 列表滚动区 -->
      <div class="pm-list">
        <div
          v-if="desktopPetStore.remoteLoading && desktopPetStore.remotePets.length === 0"
          class="pm-empty"
        >
          加载中…
        </div>
        <div
          v-else-if="desktopPetStore.remotePets.length === 0"
          class="pm-empty"
        >
          未找到宠物，换个关键词试试
        </div>
        <div
          v-else
          class="pm-grid"
        >
          <article
            v-for="pet in desktopPetStore.remotePets"
            :key="pet.id"
            class="pm-card"
            @click="openRemoteDetail(pet)"
          >
            <div class="pm-card__thumb">
              <PetThumb
                v-if="pet.spritesheetUrl"
                :src="pet.spritesheetUrl"
                :row="0"
                :col="0"
              />
              <span
                v-if="desktopPetStore.isInstalled(pet.id)"
                class="pm-card__tag pm-card__tag--done"
              >已安装</span>
            </div>
            <div class="pm-card__body">
              <h3 class="pm-card__name">{{ pet.displayName }}</h3>
              <div class="pm-card__meta">
                <span
                  v-if="pet.kind"
                  class="pm-card__kind"
                >{{ pet.kind }}</span>
                <span
                  v-if="pet.downloadCount != null"
                  class="pm-card__dl"
                >↓ {{ pet.downloadCount }}</span>
              </div>
            </div>
            <div class="pm-card__action">
              <n-button
                v-if="desktopPetStore.isInstalled(pet.id)"
                size="tiny"
                quaternary
                disabled
              >
                已安装
              </n-button>
              <n-button
                v-else
                size="tiny"
                type="primary"
                ghost
                :loading="desktopPetStore.isDownloading(pet.id)"
                @click.stop="handleQuickDownload(pet.id)"
              >
                下载
              </n-button>
            </div>
          </article>
        </div>
      </div>

      <!-- 分页（固定吸底） -->
      <nav
        v-if="desktopPetStore.remoteTotalPages > 1"
        class="pm-pager"
      >
        <n-button
          size="small"
          quaternary
          :disabled="desktopPetStore.remotePage <= 1 || desktopPetStore.remoteLoading"
          @click="desktopPetStore.goToRemotePage(desktopPetStore.remotePage - 1)"
        >
          上一页
        </n-button>
        <span class="pm-pager__info">
          {{ desktopPetStore.remotePage }} / {{ desktopPetStore.remoteTotalPages }}
        </span>
        <n-button
          size="small"
          quaternary
          :disabled="desktopPetStore.remotePage >= desktopPetStore.remoteTotalPages || desktopPetStore.remoteLoading"
          @click="desktopPetStore.goToRemotePage(desktopPetStore.remotePage + 1)"
        >
          下一页
        </n-button>
      </nav>
    </section>

    <!-- 详情弹窗 -->
    <PetDetailModal
      :visible="detailVisible"
      :pet="detailPet"
      :is-active="detailPet ? detailPet.id === desktopPetStore.activePetId : false"
      @update:visible="detailVisible = $event"
      @download="handleDetailDownload"
      @use="handleDetailUse"
    />
  </main>
</template>
<style scoped src="./index.css"></style>
