# Code mode baseline

As of 2026-11-19T15:00:00Z: the 10 most recent finished runs per job type and path, read from /data/agents/*/data/system.db.
Path engine: the engine loop, which programmatic tool calling can reach. Path cli: the Claude or Codex CLI, which it cannot.
Pass: the run finished (status done); a build also needs no later fix round on its job.

| job type | path | runs | pass | steps mean | steps median | input mean | cache reads mean | cache share | cost mean | tool calls | read-only calls | top programs |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| build | engine | 10 | 80.0% | 24 | 23 | 1056866 | 1021167 | 96.6% | $0.0572 | 268 | 0 (0.0%) | other 530, - 241, grep 186 |
| build | cli | 10 | 80.0% | 11 | 11 | 397884 | 370218 | 93.0% | - | 106 | 0 (0.0%) | other 1013, def 199, grep 102 |
| review | engine | 0 | - | - | - | - | - | - | - | - | - | - |
| review | cli | 10 | 100.0% | 5 | 5 | 215110 | 186322 | 86.6% | - | 53 | 1 (1.9%) | other 120, EVIDENCE 87, grep 82 |
| fix | engine | 10 | 100.0% | 12 | 11 | 324648 | 306838 | 94.5% | $0.0204 | 114 | 0 (0.0%) | git 175, head 113, other 91 |
| fix | cli | 10 | 100.0% | 7 | 7 | 192409 | 183070 | 95.1% | - | 69 | 0 (0.0%) | other 95, git 80, head 76 |
| proof | engine | 0 | - | - | - | - | - | - | - | - | - | - |
| proof | cli | 10 | 100.0% | 4 | 3 | 136847 | 112029 | 81.9% | - | 35 | 0 (0.0%) | ASK 156, head 19, no 16 |
| plan | engine | 0 | - | - | - | - | - | - | - | - | - | - |
| plan | cli | 10 | 100.0% | 26 | 26 | 2375401 | 2286492 | 96.3% | - | 264 | 3 (1.1%) | other 1257, head 276, grep 268 |

Verdict: stage 2 does not pay: read-only built-in calls are 0.0% of 382 engine-loop tool calls in the sampled runs (threshold 10%).
Unclassified dispatcher runs: 216

## Runs
- build engine: i1p7sxctuhs6mxipn4wbz ejc2fs3silycggusb1feb 7z62jnmo7i9q5x864q9fa bi9pauo6b57sjxilh14hu a4j4b3mkbg768kwdl0iqw y2giqz9tfogoqvuaejask 66xialcgjusw0nwuqk0yb k0r9yqh9kgu4zi6i0jtsw y9sp3vg2u96nhqs4kz9rt jbwzb29okidow2m88yewz
- build cli: 0armp60a043375yg9zdf4 s374pd8hl3lgqihm0v06x mla6td4gfuah0natuojj3 7g5bjbitfq9ti7t4axr25 hdvl8uh915z0ggfzi9k09 7vlh8z4xv1g1yg85mcov9 kkr2kc3798do6yyzuu6ge tsnhyky9w0qdmkvss2sss bydsq902prkhv8va366h9 j9b1p7x0msfbkryz5oklm
- review cli: aaohgzijao4ey8hp5p0hb imdym1nb75gbcy4v6yul2 gf7ax98x6uryzucc1j4of vecuv5evl2xnn00lmsdv6 9zkj8a1m51jc127p3jt72 5pm7b9x50nvqgaksfotqe u1ww0v700wzh11rhc7f37 mmpcma7pch6x1yd00rjiz v13gx2gey4yxthwlg2t3u au6z7yudmzg5nv7g3fgeh
- fix engine: 4s0kpicfrqolqp53aayf1 rwdux7ini5fd9ediieysl oexapuc31bldwjpbcxtdy cwu2eu7i3acr6660upn6r 3v7ejxwcrxgb7iun30bje xfc5agxwynoq291azlv8h j4yz04q4rni5v5xd15jzu jyeiqg6k6l55wxpxatrjo jwfty6e5zzv40obdnlkbx vtypjm32nuyr05i59mmcq
- fix cli: jd04suuf7gzqdlpt56wc3 nt2vgezwdar0y3day0k6d 4vs7uxap46fk8e25ua751 i1r4cms5668dbuisq71zo m8ii4eub6co5w1xaq8r7h 4lulmop5cbfvhganzxl2m mvecxm5yzqy65704l1auj ek5h1mxb7uq2yjvg6htin f0xs6mz13iechr11kzd5z pltrpgk0gb6nzt8vh4jqa
- proof cli: vwx3h9dwg808qxzac10mu ifglcmihawale756r1z89 qvrtcq2jwc8bz12t3cw1k cwxjuumcu7le71v2nqlo8 2ts15zkuqf169c8yxnaq7 m4rozd2om7zxp14gukryp 9bmn6ql1hslkxlm3u4rzy rpgofiwqmjhomneqqzzox xbujb5wzfcys9zfots4re 63ktpqa26mq5dd7tsxbx2
- plan cli: d54q74xnryjeismyfxmao ca5ar42wxcyhas8i8csgg 38v4q84dtwcaj26pgbnol goqmr90uw8l36bx9kdw61 b27j6opv1uko9qnhe4gem kr1c1hqfq65jkgqcc6xbm mivbt6uq52fqvx5kqg40q 44y3khlw6dskp4e95irqn 224wbw5sralhz4c9fgj22 rmxgtaj1f9bbceguqi2qm
