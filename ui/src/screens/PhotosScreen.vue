<script setup>
import { computed, ref, watch, onUnmounted } from 'vue';
import { state, CT, shownPhoto } from '../state.js';
import ScreenStage from '../components/ScreenStage.vue';
import StageMessage from '../components/StageMessage.vue';
// A photo frame across the whole screen, fed from an album in Photos on the Mac. The Mac picks
// the photo, crops or fits it and blurs its background, so all this does is show it.
// Two layers, so a new photo fades in over the old, which stays fully opaque underneath until
// it's covered (as Artwork.vue does for album art).
const layers = ref([null, null]);
const front = ref(0);
const under = ref(-1);
let timer;
watch(shownPhoto, photo => {
  const previous = front.value;
  const next = 1 - previous;
  layers.value[next] = photo;
  front.value = next;
  under.value = photo && layers.value[previous] ? previous : -1;
  clearTimeout(timer);
  timer = setTimeout(() => { layers.value[previous] = null; under.value = -1; }, 1200);
}, { immediate: true });
onUnmounted(() => clearTimeout(timer));
const bg = url => (url ? 'url(' + JSON.stringify(url) + ')' : 'none');

const time = computed(() => CT.clockText(CT.parts(state.now)));
const taken = computed(() => {
  const date = shownPhoto.value && shownPhoto.value.date;
  if (!date) return '';
  const p = CT.parts(date);
  return CT.MONTHS[p.month] + ' ' + p.date + ', ' + p.year;
});
const message = computed(() => {
  const status = state.photo.status;
  if (status === 'denied' || status === 'restricted')
    return { title: 'Photos access is off', detail: 'Allow “Car Thing Helper” in System Settings → Privacy & Security → Photos.' };
  if (status === 'empty') return { title: 'No photos in ' + (state.photo.album || 'Favorites') };
  if (status === 'ok' || shownPhoto.value) return {};
  if (status === 'loading' || status === 'notDetermined') return { title: 'Loading…' };
  return { title: 'Photos unavailable', detail: 'Trying again shortly.' };
});

// The Mac only fetches photos while one can be seen: this screen up and the backlight on.
const screen = CT.screen('photos');
function visible(on) { CT.send({ type: 'photos', visible: on }); }
screen.show = () => visible(!state.asleep);
screen.hide = () => visible(false);
// Its button again: the next photo now.
screen.reselect = () => CT.send({ type: 'photos', action: 'next' });
watch(() => state.asleep, asleep => { if (state.current === 'photos') visible(!asleep); });
// A Mac that has just (re)connected doesn't know the screen is up.
watch(() => state.offline, offline => { if (!offline && state.current === 'photos') visible(!state.asleep); });
</script>
<template>
  <section id="screen-photos" class="screen fill flex" :class="{ active: state.current === 'photos', leaving: state.leaving === 'photos' }">
    <ScreenStage class="bg-panel">
      <div class="ph-frame fill">
        <div v-for="(photo, i) in layers" :key="i" class="ph-layer fill" :class="{ front: i === front, under: i === under }">
          <template v-if="photo">
            <div v-if="photo.blurUrl" class="ph-img fill" :style="{ backgroundImage: bg(photo.blurUrl) }" />
            <div class="ph-img fill" :class="{ fitted: !!photo.blurUrl }" :style="{ backgroundImage: bg(photo.dataUrl) }" />
          </template>
        </div>
      </div>
      <div v-if="shownPhoto" class="ph-caption">
        <div class="font-medium semibold tabular">{{ time.time }}<span v-if="time.ampm" class="ph-ampm font-small medium">{{ time.ampm }}</span></div>
        <div v-if="taken" class="font-small weight-light ph-date">{{ taken }}</div>
      </div>
      <StageMessage :title="message.title" :detail="message.detail" />
    </ScreenStage>
  </section>
</template>
