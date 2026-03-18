export function renderLogsSection(container) {
  container.insertAdjacentHTML(
    'beforeend',
    `
    <div class="card" id="sectionLogs">
      <strong>日志</strong>
      <textarea id="logs" readonly></textarea>
    </div>
    `
  );
}
