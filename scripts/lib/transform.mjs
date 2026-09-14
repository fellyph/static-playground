import { parse, serialize } from 'parse5';
import postcss from 'postcss';
import valueParser from 'postcss-value-parser';
import parseSrcset from 'parse-srcset';

export function css(text, rewrite) {
  const tree = postcss.parse(text);
  function value(input) {
    const parsed = valueParser(input);
    parsed.walk(node => {
      if (node.type === 'function' && /^(?:-webkit-)?image-set$/i.test(node.value)) {
        for (const child of node.nodes) if (child.type === 'string') child.value = rewrite(child.value, 'asset');
      }
      if (node.type === 'function' && node.value.toLowerCase() === 'url') {
        const url = valueParser.stringify(node.nodes).replace(/^(['"])(.*)\1$/, '$2');
        node.nodes = [{ type: 'string', quote: '"', value: rewrite(url, 'asset') }];
        return false;
      }
    });
    return parsed.toString();
  }
  tree.walkDecls(decl => { decl.value = value(decl.value); });
  tree.walkAtRules(rule => {
    rule.params = value(rule.params);
    if (rule.name.toLowerCase() === 'import') {
      const parsed = valueParser(rule.params);
      if (parsed.nodes[0]?.type === 'string') parsed.nodes[0].value = rewrite(parsed.nodes[0].value, 'asset');
      rule.params = parsed.toString();
    }
  });
  return tree.toString();
}

export function html(text, rewrite, rewriteText = x => x) {
  const doc = parse(text);
  function visit(node) {
    const attrs = node.attrs || [];
    const get = name => attrs.find(a => a.name === name)?.value || '';
    if (node.tagName === 'base') throw new Error('HTML base elements require an explicit export adaptation.');
    if (node.tagName === 'form') throw new Error('Forms/search need an external or client-side integration and are outside v1.');
    for (const attr of attrs) {
      if (attr.name === 'style') attr.value = css(attr.value, rewrite);
      else if (['srcset', 'imagesrcset'].includes(attr.name)) {
        attr.value = parseSrcset(attr.value).map(item => `${rewrite(item.url, 'asset')}${item.w ? ` ${item.w}w` : item.d ? ` ${item.d}x` : ''}`).join(', ');
      } else if (['src', 'poster'].includes(attr.name) || (node.tagName === 'object' && attr.name === 'data')) attr.value = rewrite(attr.value, 'asset');
      else if (attr.name === 'href') {
        const rel = get('rel').toLowerCase().split(/\s+/);
        const kind = node.tagName === 'link' && rel.some(r => ['canonical', 'dns-prefetch', 'preconnect'].includes(r)) ? 'canonical' : node.tagName === 'link' && rel.some(r => ['stylesheet', 'icon', 'preload', 'modulepreload', 'apple-touch-icon'].includes(r)) ? 'asset' : 'link';
        attr.value = rewrite(attr.value, kind);
      } else if (node.tagName === 'meta' && attr.name === 'content') {
        const property = get('property') || get('name');
        if (['og:url', 'twitter:url'].includes(property)) attr.value = rewrite(attr.value, 'canonical');
        else if (/^(og|twitter):(image|video|audio)(:url|:secure_url)?$/.test(property)) attr.value = rewrite(attr.value, 'social-asset');
      }
      if (attr.value !== null) attr.value = rewriteText(attr.value);
    }
    if (node.attrs) node.attrs = attrs.filter(attr => attr.value !== null);
    if (node.tagName === 'style') {
      for (const child of node.childNodes || []) if (child.nodeName === '#text') child.value = rewriteText(css(child.value, rewrite));
    }
    if (node.tagName === 'script') {
      for (const child of node.childNodes || []) if (child.nodeName === '#text') {
        if (get('type') === 'importmap') {
          const map = JSON.parse(child.value);
          for (const [key, value] of Object.entries(map.imports || {})) map.imports[key] = rewrite(value, 'asset');
          for (const scope of Object.values(map.scopes || {})) for (const [key, value] of Object.entries(scope)) scope[key] = rewrite(value, 'asset');
          child.value = JSON.stringify(map);
        }
        child.value = rewriteText(child.value);
      }
    }
    for (const child of node.childNodes || []) visit(child);
    if (node.content) visit(node.content);
  }
  visit(doc);
  return serialize(doc);
}
