import re, json, importlib, os, sys
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from extract import PAGES, TOKEN, ATTR, has_words
import os
SRC=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..')+'/'
FR='https://soundlightprod.fr/'; COM='https://soundlightprod.com/'
strings=json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)),'strings.json')))
IDX={s:i for i,(p,s) in enumerate(strings)}
PAGESET=set(PAGES)
LABEL={'fr':'FR','en':'EN','es':'ES'}

def url_for(lang,page):
    name='' if page=='index' else page+'.html'
    return (FR if lang=='fr' else COM+lang+'/')+name

def head_links(page):
    out=[f'<link rel="alternate" hreflang="{l}" href="{url_for(l,page)}">' for l in ('fr','en','es')]
    out.append(f'<link rel="alternate" hreflang="x-default" href="{url_for("fr",page)}">')
    return '\n'.join(out)

SWITCH_CSS='<style>.lang-switch{display:flex;gap:2px;margin-left:18px;flex-shrink:0;font-family:\'JetBrains Mono\',monospace;font-size:0.72rem;font-weight:700;letter-spacing:0.04em}.lang-switch a{color:var(--muted);text-decoration:none;padding:4px 7px;border:1px solid transparent;border-radius:4px;transition:color .2s ease,border-color .2s ease}.lang-switch a:hover{color:var(--paper)}.lang-switch a.on{color:var(--paper);border-color:var(--line)}</style>'
def switcher(lang,page):
    a=[]
    for l in ('fr','en','es'):
        cls=' class="on" aria-current="true"' if l==lang else ''
        a.append(f'<a href="{url_for(l,page)}" hreflang="{l}" lang="{l}"{cls}>{LABEL[l]}</a>')
    return '\n    <div class="lang-switch" aria-label="Language">'+''.join(a)+'</div>'

def rewrite_url(u):
    if not u or re.match(r'^(https?:|mailto:|tel:|data:|#|/|javascript:|\$\{)',u): return u
    base=re.split(r'[?#]',u)[0]
    if base.endswith('.html'):
        stem=base[:-5]
        if stem in PAGESET: return u
        return FR+u
    return '/'+u

def tr_text(s,T):
    core=s.strip()
    if not core or core not in IDX: return s
    t=T.get(IDX[core])
    if not t: return s
    lead=s[:len(s)-len(s.lstrip())]; trail=s[len(s.rstrip()):]
    return lead+t+trail

def process_tag(tag,T,lang):
    def attr_sub(m):
        name,val=m.group(1),m.group(2)
        if name.lower()=='content' and not re.search(r'(name|property)="(description|og:title|og:description|twitter:title|twitter:description|keywords)"',tag): return m.group(0)
        return f'{name}="{tr_text(val,T)}"'
    if T: tag=ATTR.sub(attr_sub,tag)
    if lang!='fr':
        tag=re.sub(r'\b(href|src|poster|data-src)="([^"]*)"',lambda m:f'{m.group(1)}="{rewrite_url(m.group(2))}"',tag)
        tag=re.sub(r"url\((['\"]?)([^'\")]+)\1\)",lambda m:f"url({m.group(1)}{rewrite_url(m.group(2))}{m.group(1)})",tag)
    return tag

def build(page,lang):
    raw=open(SRC+page+'.html',encoding='utf-8').read()
    T={}; JS={}; loc=None
    if lang!='fr':
        mod=importlib.import_module(lang); T=mod.T; JS={k:v for k,v in mod.JS.items() if v}; loc=mod.LOCALE
    parts=TOKEN.split(raw); out=[]
    for part in parts:
        if not part: continue
        if part.startswith('<!--'): out.append(part); continue
        low=part[:7].lower()
        if low.startswith('<script') or low.startswith('<style'):
            if lang!='fr':
                for k,v in JS.items(): part=part.replace(k,v)
                part=part.replace("'fr-FR'",f"'{loc}'")
                part=re.sub(r"url\((['\"]?)([^'\")]+)\1\)",lambda m:f"url({m.group(1)}{rewrite_url(m.group(2))}{m.group(1)})",part)
            out.append(part)
        elif part.startswith('<'):
            out.append(process_tag(part,T,lang))
        else:
            out.append(tr_text(part,T) if T else part)
    html=''.join(out)
    # stale SIRET fix (all languages)
    html=html.replace('SIRET 514 912 492 00055','SIRET 130 415 045 00017')
    if lang!='fr': html=html.replace('>06 31 94 96 53<','>+33 6 31 94 96 53<')
    html=re.sub(r'<html lang="[a-z]+"',f'<html lang="{lang}"',html,1)
    # remove previous injection (idempotent on FR sources)
    html=re.sub(r'\n?<!-- i18n:start -->.*?<!-- i18n:end -->','',html,flags=re.S)
    html=re.sub(r'\n?    <div class="lang-switch".*?</div>','',html,flags=re.S)
    inj='\n<!-- i18n:start -->\n'+head_links(page)+'\n'+SWITCH_CSS+'\n<!-- i18n:end -->\n'
    html=html.replace('</head>',inj+'</head>',1)
    if '</nav>' in html:
        html=html.replace('</nav>','</nav>'+switcher(lang,page),1)
    return html

if __name__=='__main__':
    for lang in ('en','es','fr'):
        d=SRC if lang=='fr' else SRC+lang+'/'
        os.makedirs(d,exist_ok=True)
        for p in PAGES:
            html=build(p,lang)
            open(d+p+'.html','w',encoding='utf-8').write(html)
    print('built')
