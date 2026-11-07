export const ROBOTS_TXT_MAX_BYTES = 64 * 1024;
export function parseRobotsTxt(text) {
    const groups = [];
    const sitemaps = [];
    let current = null;
    for (const raw of text.slice(0, ROBOTS_TXT_MAX_BYTES).split(/\r\n|\r|\n/u)) {
        const line = raw.replace(/#.*$/u, '').trim();
        const match = /^([A-Za-z-]+)\s*:\s*(.*)$/u.exec(line);
        if (!match)
            continue;
        const key = match[1].toLowerCase(), value = match[2].trim();
        if (key === 'user-agent') {
            // 規則のあとの User-agent は新しい組の始まり。続けて並んだ User-agent は同じ組。
            if (!current || current.rules.length) {
                current = { agents: [], rules: [] };
                groups.push(current);
            }
            if (value)
                current.agents.push(value.toLowerCase());
        }
        else if (key === 'allow' || key === 'disallow') {
            if (!current)
                continue;
            // 空の Disallow は「すべて許す」なので規則にしない。
            if (value)
                current.rules.push({ allow: key === 'allow', path: value });
        }
        else if (key === 'sitemap' && value)
            sitemaps.push(value);
    }
    return { groups: groups.filter(group => group.agents.length), sitemaps };
}
export function robotsRulesFor(robots, agent) {
    const token = agent.toLowerCase();
    const named = robots.groups.filter(group => group.agents.includes(token));
    if (named.length)
        return named.flatMap(group => group.rules);
    const star = robots.groups.filter(group => group.agents.includes('*'));
    return star.length ? star.flatMap(group => group.rules) : null;
}
export function robotsNamesAgent(robots, agent) {
    const token = agent.toLowerCase();
    return robots.groups.some(group => group.agents.includes(token));
}
// Match the same prefix/wildcard rules without building an untrusted regexp.
const matchesPath = (rule, path) => {
    const pattern = rule.endsWith('$') ? rule.slice(0, -1) : `${rule}*`;
    let p = 0, i = 0, star = -1, retry = 0;
    while (i < path.length) {
        if (pattern[p] === '*') { star = p++; retry = i; }
        else if (p < pattern.length && pattern[p] === path[i]) { p++; i++; }
        else if (star >= 0) { p = star + 1; i = ++retry; }
        else return false;
    }
    while (pattern[p] === '*') p++;
    return p === pattern.length;
};
export function robotsAllows(robots, agent, path) {
    const rules = robotsRulesFor(robots, agent);
    if (!rules?.length)
        return true;
    let best = null;
    for (const rule of rules) {
        if (!matchesPath(rule.path, path))
            continue;
        if (!best || rule.path.length > best.path.length || (rule.path.length === best.path.length && rule.allow && !best.allow))
            best = rule;
    }
    return best ? best.allow : true;
}
