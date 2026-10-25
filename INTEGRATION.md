# MeTube ABR tools — integration bundle

This ZIP contains only changed/new files, with paths relative to the MeTube repository root.

## Apply the frontend changes

1. Extract this folder.
2. Copy `frontend/src/App.jsx` over your existing `frontend/src/App.jsx`.
3. Add `frontend/src/AbrExperimentPage.jsx` and `frontend/src/abr-lab.css` at those exact paths.
4. From your repository's `frontend/` folder, run `npm run build`.
5. Start MeTube and open a ready video. Use **Open ABR experiment lab** or visit `/experiment/<video-id>`.

The normal `/watch/:id` player remains unchanged. The experiment route creates its own hls.js instance.

## Generate figures offline

Install Python dependencies with `python -m pip install -r tools/abr/plot-requirements.txt`, then run:

```bash
python tools/abr/plot_abr.py /path/to/exported-experiment.csv
```

The script writes a PNG and PDF beside the CSV. Full instructions and limitations are in `tools/abr/README.md`.

## Optional network shaping

`tools/abr/run-ingress-profiles.sh` is an optional Linux-only helper. Read its warning in the README before use. It temporarily changes traffic-control rules and should only be run on a dedicated test interface/machine.
