export function renderSubmitSection(container) {
  container.insertAdjacentHTML(
    'beforeend',
    `
    <div class="card" id="sectionSubmit">
      <div class="row">
        <button id="submitBtn">提交任务</button>
        <a id="downloadLink" class="btn success" style="display:none" href="#" target="_blank" rel="noopener">下载 APK</a>
      </div>
      <div class="row" style="margin-top:8px;">
        <span id="submitStatus" class="muted">等待提交</span>
      </div>
    </div>
    `
  );
}

export function createSubmitSection({ host, getPayload }) {
  let pollingTimer = null;
  let isSubmitting = false;

  function setStatus(text) {
    const el = document.getElementById('submitStatus');
    if (el) el.textContent = text;
  }

  function setSubmitting(value) {
    isSubmitting = Boolean(value);
    const btn = document.getElementById('submitBtn');
    if (btn) btn.disabled = isSubmitting;
  }

  function setDownload(url, label = '下载 APK') {
    const link = document.getElementById('downloadLink');
    if (!link) return;
    if (url) {
      link.href = url;
      link.textContent = label;
      link.style.display = 'inline-flex';
    } else {
      link.style.display = 'none';
    }
  }

  async function pollRun(runId) {
    if (!runId) return;
    const res = await host.authFetch(`/plugin/runs/${encodeURIComponent(runId)}`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error?.message || '任务状态获取失败');
    const data = json?.data || json;
    const status = data.status || 'unknown';
    if (status === 'success') {
      clearInterval(pollingTimer);
      pollingTimer = null;
      setSubmitting(false);
      setStatus('任务完成');
      const artifact = Array.isArray(data.artifacts) ? data.artifacts[0] : null;
      if (artifact?.artifactId) {
        const url = host.buildUrl(`/plugin/artifacts/${artifact.artifactId}?tenantId=${encodeURIComponent(host.state.tenantId || 'default')}`);
        setDownload(url, artifact.name || '下载 APK');
      }
      return;
    }
    if (status === 'failed') {
      clearInterval(pollingTimer);
      pollingTimer = null;
      setSubmitting(false);
      setStatus('任务失败，请检查配置');
      return;
    }
    setStatus(`执行中：${status}`);
  }

  async function submit() {
    if (isSubmitting) return;
    const payload = await getPayload();
    if (!payload) return;
    setSubmitting(true);
    setStatus('提交中...');
    setDownload('');

    const res = await host.authFetch('/plugin/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    if (!res.ok) {
      setSubmitting(false);
      throw new Error(text.slice(0, 200) || '提交失败');
    }
    let runId = '';
    try {
      const json = JSON.parse(text);
      const data = json?.data || json;
      runId = data?.runId || '';
    } catch {
      runId = '';
    }

    if (runId) {
      setStatus('已提交，执行中...');
      pollingTimer = setInterval(() => {
        pollRun(runId).catch((e) => setStatus(`状态获取失败: ${e.message}`));
      }, 1200);
      await pollRun(runId);
      return;
    }

    setSubmitting(false);
    setStatus('提交成功');
  }

  function bind() {
    const btn = document.getElementById('submitBtn');
    if (btn) {
      btn.addEventListener('click', () => {
        submit().catch((e) => setStatus(e.message || '提交失败'));
      });
    }
  }

  return { bind, setStatus, setSubmitting };
}
