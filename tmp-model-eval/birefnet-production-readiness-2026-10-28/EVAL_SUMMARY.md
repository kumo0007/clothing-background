# BiRefNet production-readiness eval (Node WASM)

Generated: 2026-10-27T15:23:53.399Z

Init 9595 ms · first 11679 ms · warm reuse 10945 ms

## Fixtures vs baseline

| ID | KEEP% | Δ baseline | Infer ms | RGB OK | Soft α% | Border KEEP |
| --- | ---: | ---: | ---: | --- | ---: | ---: |
| dark-hoodie | 55.43 | 0 | 11679 | true | 0.0508 | 0 |
| white-tshirt | 49.04 | 0 | 11182 | true | 0.0326 | 0 |
| white-sneakers | 34.5 | 0 | 11139 | true | 0.0262 | 0 |
| open-handbag | 35.68 | 0 | 11157 | true | 0.0547 | 0 |
| polo-carpet-closeup | 73.89 | 0 | 10778 | true | 0.018 | 0.5904 |

## Cleanup candidates

| Cleanup | Mean IoU vs raw | Material regressions | Recommend |
| --- | ---: | ---: | --- |
| morphOpen-r1 | 0.9998 | 0 | no — No objective quality gain vs raw BiRefNet across fixtures; leave production unch |
| morphClose-r1 | 0.99892 | 0 | no — Conservative default: gains not proven across hard cases without human GT; leave |
| fillMaskHoles | 0.97058 | 1 | no — material regression on 1/5 fixtures (IoU<0.985 or |Δkeep|>0.015 or border KEEP↑> |
| feather-r1 | 1 | 0 | no — No objective quality gain vs raw BiRefNet across fixtures; leave production unch |
| refineSilhouetteBoundary | 0.9859 | 1 | no — material regression on 1/5 fixtures (IoU<0.985 or |Δkeep|>0.015 or border KEEP↑> |
| refineBoundaryAlpha | 0.98445 | 3 | no — material regression on 3/5 fixtures (IoU<0.985 or |Δkeep|>0.015 or border KEEP↑> |
| repairSdkUnderRecall | 0.89635 | 4 | no — material regression on 4/5 fixtures (IoU<0.985 or |Δkeep|>0.015 or border KEEP↑> |

Decision: Leave BiRefNet segment path unchanged — no cleanup candidate demonstrated objective improvement without material risk
