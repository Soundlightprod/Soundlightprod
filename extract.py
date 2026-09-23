import re, json, html, sys
import os
SRC=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..')+'/'
PAGES="index artistes son-lumiere diffusion agenda galerie contact cabaret dj groupes-de-reprises jazz-soul-funk pop-francaise tributes alchimie cache-candy calo-2-0 dj-provisoire noon-coverband panache the-best-abba-tribute the-fine-allies voice-of-freedom mentions-legales".split()
TOKEN=re.compile(r'(<!--.*?-->|<script\b.*?</script>|<style\b.*?</style>|<[^>]+>)', re.S|re.I)
ATTR=re.compile(r'\b(alt|title|placeholder|aria-label|content)\s*=\s*"([^"]*)"', re.I)
def has_words(s): return re.search(r'[A-Za-zÀ-ÿ]{2,}', s) is not None
def units(raw):
    out=[]
    for part in TOKEN.split(raw):
        if not part: continue
        if part.startswith('<'):
            if part[:7].lower() in ('<script','<style>') or part.startswith('<!--') or part[:6].lower()=='<style': continue
            tag=part
            for m in ATTR.finditer(tag):
                name,val=m.group(1).lower(),m.group(2)
                if name=='content':
                    if not re.search(r'(name|property)="(description|og:title|og:description|twitter:title|twitter:description|keywords)"',tag): continue
                if has_words(val) and not val.startswith(('http','#','/')): out.append(val.strip())
        else:
            t=part.strip()
            if t and has_words(t): out.append(t)
    return out
if __name__=='__main__':
    seen={}; order=[]
    for p in PAGES:
        raw=open(SRC+p+'.html',encoding='utf-8').read()
        for u in units(raw):
            if u not in seen: seen[u]=p; order.append(u)
    json.dump([[seen[u],u] for u in order],open('strings-new.json','w'),ensure_ascii=False,indent=0)
    print(len(order), sum(len(u) for u in order))
