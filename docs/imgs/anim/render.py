import argparse, subprocess, sys, os, re
from playwright.sync_api import sync_playwright
ap=argparse.ArgumentParser(); ap.add_argument('html'); ap.add_argument('--frames'); ap.add_argument('--mp4')
ap.add_argument('--loopcheck',action='store_true'); ap.add_argument('--gif'); ap.add_argument('--out',default='.')
a=ap.parse_args()
src=open(a.html,encoding='utf-8').read()
m=re.search(r'viewBox="0 0 (\d+) (\d+)"',src); W,H=int(m[1]),int(m[2])
url='file://'+os.path.abspath(a.html)+'?capture'
with sync_playwright() as p:
    b=p.chromium.launch(executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    pg=b.new_page(viewport={'width':W,'height':H}); errs=[]
    pg.on('pageerror',lambda e: errs.append(str(e)))
    pg.goto(url); pg.wait_for_timeout(300)
    if errs: sys.exit('Erro de JavaScript na página:\n'+'\n'.join(errs))
    T=pg.evaluate('window.__T'); FPS=pg.evaluate('window.__FPS'); N=round(T*FPS)
    seek="t=>new Promise(r=>{window.__seek(t);requestAnimationFrame(()=>requestAnimationFrame(r))})"
    shot=lambda t: (pg.evaluate(seek, t), pg.screenshot(type='png'))[1]
    shot(0)
    if a.frames:
        for s in a.frames.split(','):
            f=f'{a.out}/frame_{float(s):06.2f}.png'; open(f,'wb').write(shot(float(s))); print(f)
    if a.loopcheck:
        from PIL import Image, ImageChops; import io
        i0=Image.open(io.BytesIO(shot(0))).convert('RGB'); iT=Image.open(io.BytesIO(shot(T))).convert('RGB')
        iL=Image.open(io.BytesIO(shot((N-1)/FPS))).convert('RGB')
        d=ImageChops.difference(i0,iT).getbbox(); j=ImageChops.difference(iL,i0)
        print('t=0 vs t=T:', 'IDÊNTICOS' if d is None else f'DIFERENTES em {d}')
        print('salto último→primeiro (média px):', round(sum(j.convert("L").tobytes())/(W*H),2), '(< 3 é suave)')
    if a.mp4:
        tmp=a.mp4[:-4]+'.tmp.mp4'
        ff=subprocess.Popen(['ffmpeg','-y','-loglevel','error','-f','image2pipe','-framerate',str(FPS),'-i','-',
            '-c:v','libx264','-preset','veryfast','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',tmp],stdin=subprocess.PIPE)
        for i in range(N): ff.stdin.write(shot(i/FPS))
        ff.stdin.close()
        if ff.wait()==0: os.replace(tmp,a.mp4); print('ok',a.mp4,N,'quadros')
        else: sys.exit('ffmpeg falhou')
        if a.gif:
            subprocess.run(['ffmpeg','-y','-loglevel','error','-i',a.mp4,'-vf',
              'fps=15,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle',a.gif],check=True); print('ok',a.gif)
    b.close()
