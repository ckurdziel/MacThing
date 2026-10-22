<script setup>
import { computed, ref, watch, nextTick, onMounted } from 'vue';
import { state, CT } from '../state.js';
import LeftRail from '../components/LeftRail.vue';
import ScreenStage from '../components/ScreenStage.vue';
import StageMessage from '../components/StageMessage.vue';
// Apple Reminders that aren't done yet, soonest due first (the Mac sorts them). Read only: the
// knob stays on the volume.
const list = ref(null), shown = ref(0);
// Due labels only change by the minute, so the list isn't redrawn every second.
const minute = computed(() => Math.floor(state.now / 60000) * 60000);
const ok = computed(() => state.todo.status === 'ok');
const reminders = computed(() => (ok.value ? state.todo.reminders || [] : []));

// "3 PM", or "3:30 PM"; the 24-hour clock always shows its minutes.
function shortTime(ms) {
  const p = CT.parts(ms);
  if (CT.settings.clock24h || p.minutes) return CT.timeText(ms);
  return (p.hours % 12 || 12) + ' ' + (p.hours < 12 ? 'AM' : 'PM');
}
function overdue(r, now) {
  return r.due != null && (r.allDay ? CT.dayNumber(r.due) < CT.dayNumber(now) : r.due < now);
}
// Today 3 PM, Tomorrow, Thu, Nov 4; past ones: Overdue · Mon.
function dueLabel(r, now) {
  if (r.due == null) return '';
  const days = CT.dayNumber(r.due) - CT.dayNumber(now), p = CT.parts(r.due);
  const day = CT.DAYS[p.day].slice(0, 3), date = CT.MONTHS[p.month].slice(0, 3) + ' ' + p.date;
  if (overdue(r, now)) return 'Overdue · ' + (days === 0 ? shortTime(r.due) : days === -1 ? 'Yesterday' : days > -7 ? day : date);
  if (days === 0) return r.allDay ? 'Today' : 'Today ' + shortTime(r.due);
  if (days === 1) return 'Tomorrow';
  return days < 7 ? day : date;
}
const rows = computed(() => reminders.value.map(r => ({ r, label: dueLabel(r, minute.value), late: overdue(r, minute.value) })));
// The rail counts what needs doing first: overdue, else due today, else everything.
const rail = computed(() => {
  if (!ok.value) return { title: '--', subtitle: '' };
  const all = state.todo.total || rows.value.length; // reminders past the 60 sent count too
  const late = rows.value.filter(row => row.late).length;
  const today = rows.value.filter(row => !row.late && row.r.due != null && CT.dayNumber(row.r.due) === CT.dayNumber(minute.value)).length;
  if (late) return { title: late, subtitle: 'overdue', late: true, total: all > late ? all + ' in all' : '' };
  if (today) return { title: today, subtitle: 'due today', total: all > today ? all + ' in all' : '' };
  if (all) return { title: all, subtitle: 'to do' };
  return { title: 0, subtitle: 'All done' };
});
const message = computed(() => {
  const status = state.todo.status;
  if (['denied', 'restricted', 'writeOnly'].includes(status))
    return { title: 'Reminders access is off', detail: 'Allow “Car Thing Helper” in System Settings → Privacy & Security → Reminders.' };
  if (['loading', 'notDetermined'].includes(status)) return { title: 'Loading your reminders…' };
  if (status !== 'ok') return { title: 'Reminders unavailable', detail: 'Trying again shortly.' };
  if (!rows.value.length) return { title: 'All done', detail: 'Nothing left to do.' };
  return {};
});

// As many as fit, then "+N more" under them.
let generation = 0;
async function fit() {
  const run = ++generation;
  shown.value = rows.value.length;
  await nextTick();
  const el = list.value;
  if (run !== generation || !el || el.scrollHeight <= el.clientHeight) return;
  const more = 44; // the "+N more" line and the space above it
  const items = el.querySelectorAll('.td-row');
  let fits = 0;
  while (fits < items.length && items[fits].offsetTop + items[fits].offsetHeight <= el.clientHeight - more) fits++;
  shown.value = Math.max(1, fits);
}
// Separate sources, each compared on its own (see CalendarScreen.vue).
watch([() => state.todo, () => state.settings, minute, () => state.current], fit);
const screen = CT.screen('todo');
screen.show = fit;
onMounted(() => {
  fit();
  if (document.fonts) document.fonts.ready.then(fit);
});
</script>
<template>
  <section id="screen-todo" class="screen fill flex" :class="{ active: state.current === 'todo', leaving: state.leaving === 'todo' }">
    <LeftRail eyebrow="Reminders" :title="rail.title" :lower-content="rail.total || ''">
      <template v-if="rail.subtitle" #subtitle><span :class="{ accent: rail.late }">{{ rail.subtitle }}</span></template>
    </LeftRail>
    <ScreenStage class="bg-panel">
      <div ref="list" class="td-list overflow-hidden stage-safe">
        <div v-for="row in rows.slice(0, shown)" :key="row.r.id" class="td-row flex items-center font-small">
          <span class="td-dot flex-none" :style="{ background: row.r.color || '' }" />
          <span class="td-title flex-1 semibold truncate">{{ row.r.title || 'Untitled' }}</span>
          <span v-if="row.label" class="td-due flex-none medium" :class="row.late ? 'accent' : 'secondary'">{{ row.label }}</span>
        </div>
        <div v-if="(state.todo.total || rows.length) > shown" class="mt-16 font-small medium muted">+{{ (state.todo.total || rows.length) - shown }} more</div>
      </div>
      <StageMessage :title="message.title" :detail="message.detail" />
    </ScreenStage>
  </section>
</template>
