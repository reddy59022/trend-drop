// Minimal Prometheus exposition registry.
// Kept dependency-free so metrics cannot become another payment-path failure
// point. Labels are deliberately finite/canonical to prevent cardinality leaks.
const counters = new Map();
const gauges = new Map();

const SAFE_LABEL = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const ALLOWED_LABELS = new Set(['operation', 'reason', 'event_type', 'result', 'source', 'status']);
const escapeLabel = (value) => String(value)
  .replace(/\\/g, '\\\\')
  .replace(/"/g, '\\"')
  .replace(/\n/g, '\\n');

const normalizeLabels = (labels = {}) => Object.keys(labels)
  .filter((key) => ALLOWED_LABELS.has(key) && SAFE_LABEL.test(key))
  .sort()
  .reduce((out, key) => {
    out[key] = String(labels[key] ?? 'unknown').slice(0, 64);
    return out;
  }, {});

const labelsKey = (labels) => Object.entries(labels)
  .map(([key, value]) => `${key}=${value}`)
  .join(',');

const increment = (name, labels = {}, value = 1) => {
  if (!SAFE_LABEL.test(name) || !Number.isFinite(value) || value < 0) return;
  const normalized = normalizeLabels(labels);
  const key = `${name}|${labelsKey(normalized)}`;
  const current = counters.get(key);
  counters.set(key, {
    name,
    labels: normalized,
    value: (current?.value || 0) + value,
  });
};

const setGauge = (name, value, labels = {}) => {
  if (!SAFE_LABEL.test(name) || !Number.isFinite(value)) return;
  const normalized = normalizeLabels(labels);
  const key = `${name}|${labelsKey(normalized)}`;
  gauges.set(key, { name, labels: normalized, value });
};

const render = () => {
  const lines = [
    '# HELP trenddrop_process_uptime_seconds Process uptime in seconds.',
    '# TYPE trenddrop_process_uptime_seconds gauge',
    `trenddrop_process_uptime_seconds ${process.uptime()}`,
  ];
  const counterFamilies = new Set();
  for (const metric of counters.values()) counterFamilies.add(metric.name);
  for (const name of [...counterFamilies].sort()) {
    lines.push(`# TYPE ${name} counter`);
    for (const metric of [...counters.values()]
      .filter((entry) => entry.name === name)
      .sort((a, b) => labelsKey(a.labels).localeCompare(labelsKey(b.labels)))) {
      const labelText = Object.entries(metric.labels)
        .map(([key, value]) => `${key}="${escapeLabel(value)}"`)
        .join(',');
      lines.push(`${name}${labelText ? `{${labelText}}` : ''} ${metric.value}`);
    }
  }

  const gaugeFamilies = new Set();
  for (const metric of gauges.values()) gaugeFamilies.add(metric.name);
  for (const name of [...gaugeFamilies].sort()) {
    lines.push(`# TYPE ${name} gauge`);
    for (const metric of [...gauges.values()]
      .filter((entry) => entry.name === name)
      .sort((a, b) => labelsKey(a.labels).localeCompare(labelsKey(b.labels)))) {
      const labelText = Object.entries(metric.labels)
        .map(([key, value]) => `${key}="${escapeLabel(value)}"`)
        .join(',');
      lines.push(`${name}${labelText ? `{${labelText}}` : ''} ${metric.value}`);
    }
  }
  return `${lines.join('\n')}\n`;
};

const reset = () => {
  counters.clear();
  gauges.clear();
};

module.exports = {
  increment,
  setGauge,
  render,
  reset,
};
