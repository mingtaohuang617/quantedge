# Mining Alpha — 因子目录

> 自动生成。共 **191 / 191** 个因子。
> 来源：`mining_alpha.alpha191_factors._ALPHA_REGISTRY` 注册器。
> 运行 `python -m mining_alpha.catalog` 重新生成。

## 分类分布

| 分类 | 数量 |
|---|---|
| 杂 | 47 |
| 量价相关性 | 31 |
| 动量 / 反转 | 31 |
| 波动 / ATR | 17 |
| DECAY / CORR 组合 | 16 |
| MFI / 资金流 | 12 |
| KDJ / RSI / WR | 11 |
| 极值位置 | 5 |
| 多周期均线 | 5 |
| ADX / DTM / DBM | 5 |
| 趋势回归 | 3 |
| 基准依赖 | 3 |
| TRIX / MACD | 3 |
| 复杂条件 | 2 |

## 杂 (47)

| α# | 函数 | 描述 |
|---:|---|---|
| 6 | `alpha_6` | -RANK(SIGN(DELTA(0.85*O+0.15*H, 4))) |
| 7 | `alpha_7` | (RANK(MAX(VWAP-CLOSE,3))+RANK(MIN(VWAP-CLOSE,3)))*RANK(ΔVOL,3) |
| 8 | `alpha_8` | RANK(ΔP*-1)  P=0.2*(H+L)/2+0.8*VWAP |
| 12 | `alpha_12` | RANK(O-MEAN(VWAP,10)) * -RANK(ABS(C-VWAP)) |
| 13 | `alpha_13` | sqrt(H*L) - VWAP 几何均价 vs VWAP |
| 17 | `alpha_17` | RANK(VWAP - MAX(VWAP, 15)) ^ DELTA(C, 5) |
| 27 | `alpha_27` | WMA(ROC3 + ROC6, 12) 双周期 ROC 加权 |
| 30 | `alpha_30` | WMA(残差^2, 20) 用 MKT 单因子残差代替 FF 三因子 |
| 31 | `alpha_31` | (C - MEAN(C,12))/MEAN(C,12)*100 12 日均线偏离% |
| 34 | `alpha_34` | MEAN(C, 12) / C  12 日均线/当前价 比值 |
| 40 | `alpha_40` | 26 日上涨量/下跌量 比值 × 100 |
| 41 | `alpha_41` | -RANK(MAX(ΔVWAP, 3, 5)) VWAP 短期跳变 |
| 48 | `alpha_48` | -(RANK(sign-sum 3 日) * SUM(V,5)/SUM(V,20)) |
| 49 | `alpha_49` | SUM(下降能量, 12) / (SUM(下降能量,12) + SUM(上升能量,12)) |
| 50 | `alpha_50` | (SUM(上升能量,12) - SUM(下降能量,12)) / (SUM(上升,12) + SUM(下降,12)) |
| 51 | `alpha_51` | SUM(上升能量,12) / (SUM(上升,12) + SUM(下降,12))  与 Alpha49 互补 |
| 65 | `alpha_65` | MEAN(C, 6) / C  6 日均线 / 现价 |
| 66 | `alpha_66` | (C-MEAN(C,6))/MEAN(C,6)*100 6 日均线偏离% |
| 68 | `alpha_68` | SMA(((H+L)/2 - prev(H+L)/2) * (H-L)/V, 15, 2) Alpha9 的 15 日版本 |
| 71 | `alpha_71` | (C-MEAN(C,24))/MEAN(C,24)*100 24 日均线偏离% |
| 81 | `alpha_81` | SMA(VOL, 21, 2) 量的 EWMA(α=2/21) |
| 85 | `alpha_85` | TSRANK(V/MEAN(V,20), 20) * TSRANK(-ΔC(7), 8) |
| 98 | `alpha_98` | 长周期(100日)均线漂移 < 5%: -(C-TSMIN(C,100)); 否则: -ΔC(3) |
| 102 | `alpha_102` | SMA(MAX(ΔV,0), 6, 1) / SMA(\|ΔV\|, 6, 1) × 100  量能 VR |
| 109 | `alpha_109` | SMA(H-L, 10, 2) / SMA(SMA(H-L, 10, 2), 10, 2) 波幅平滑比 |
| 111 | `alpha_111` | SMA(V*((C-L)-(H-C))/(H-L), 11, 2) - SMA(同, 4, 2)  (论文 VOL→VOLUME 修正) |
| 117 | `alpha_117` | TSRANK(V,32) * (1-TSRANK(H+C-L,16)) * (1-TSRANK(RET,32)) |
| 118 | `alpha_118` | SUM(H-O, 20)/SUM(O-L, 20)*100 上下影线相对强度 |
| 120 | `alpha_120` | RANK(VWAP-C) / RANK(VWAP+C) |
| 122 | `alpha_122` | 3 层 SMA log 的 1 日变化率 |
| 126 | `alpha_126` | (C+H+L)/3 当日典型价 |
| 129 | `alpha_129` | SUM(\|negative ΔC\|, 12) |
| 132 | `alpha_132` | MEAN(AMOUNT, 20) 20 日均成交额 |
| 137 | `alpha_137` | MFM 当日值（Alpha55 的非累加版本） |
| 142 | `alpha_142` | -RANK(TSRANK(C,10)) * RANK(Δ(ΔC,1)) * RANK(TSRANK(V/MEAN(V,20),5)) |
| 143 | `alpha_143` | 累计正收益强度 (论文 SELF 递归近似为只在上涨日 *= ret) |
| 145 | `alpha_145` | (MEAN(V,9) - MEAN(V,26)) / MEAN(V,12) * 100 |
| 158 | `alpha_158` | (H - SMA(C,15,2) - (L - SMA(C,15,2))) / C 振幅相对收盘价 |
| 163 | `alpha_163` | RANK(-RET * MEAN(V,20) * VWAP * (H-C)) |
| 166 | `alpha_166` | 20 日收益率滚动偏度 (论文公式断裂，按标准 skewness 实现) |
| 168 | `alpha_168` | -V / MEAN(V, 20) 当日量相对 20 日均量取负 |
| 171 | `alpha_171` | -((L-C)*O^5) / ((C-H)*C^5) |
| 173 | `alpha_173` | 3*SMA(C,13,2) - 2*SMA(SMA(C,13,2),13,2) + SMA(SMA(SMA(log(C),13,2),13,2),13,2) |
| 180 | `alpha_180` | 放量日: -TSRANK(\|ΔC(7)\|,60)*SIGN(ΔC(7))；其他: -V |
| 181 | `alpha_181` | 20 日个股超额收益偏离 vs 大盘偏离平方的累计 / 大盘偏离三次方累计 |
| 185 | `alpha_185` | RANK(-(1-O/C)^2) 开收比平方反向排名 |
| 188 | `alpha_188` | ((H-L - SMA(H-L,11,2)) / SMA(H-L,11,2)) * 100 (论文 em-dash 修正) |

## 量价相关性 (31)

| α# | 函数 | 描述 |
|---:|---|---|
| 1 | `alpha_1` | -CORR(RANK(ΔLOG(VOL)), RANK((C-O)/O), 6) 量价反转 |
| 5 | `alpha_5` | -TSMAX(CORR(TSRANK(V,5), TSRANK(H,5), 5), 3) |
| 16 | `alpha_16` | -TSMAX(RANK(CORR(RANK(V), RANK(VWAP), 5)), 5) |
| 26 | `alpha_26` | (SUM(C,7)/7 - C) + CORR(VWAP, DELAY(C,5), 230) |
| 32 | `alpha_32` | -SUM(RANK(CORR(RANK(H), RANK(V), 3)), 3) |
| 36 | `alpha_36` | RANK(SUM(CORR(RANK(V), RANK(VWAP), 6), 2)) |
| 45 | `alpha_45` | RANK(Δ(0.6C+0.4O,1)) * RANK(CORR(VWAP, MEAN(V,150), 15)) |
| 56 | `alpha_56` | RANK(O-TSMIN(O,12)) < RANK(RANK(CORR(SUM((H+L)/2,19), SUM(MEAN(V,40),19),13))^5) |
| 62 | `alpha_62` | -CORR(HIGH, RANK(V), 5) |
| 74 | `alpha_74` | RANK(CORR(SUM(0.35L+0.65VWAP,20), SUM(MEAN(V,40),20),7)) + RANK(CORR(RANK(VWAP),RANK(V),6)) |
| 83 | `alpha_83` | -RANK(COV(RANK(H), RANK(V), 5)) |
| 90 | `alpha_90` | -RANK(CORR(RANK(VWAP), RANK(V), 5)) |
| 91 | `alpha_91` | RANK(C-MAX(C,5)) * RANK(CORR(MEAN(V,40),L,5)) * -1 |
| 99 | `alpha_99` | -RANK(COV(RANK(C), RANK(V), 5)) |
| 101 | `alpha_101` | (RANK(CORR(C, SUM(MEAN(V,30),37), 15)) < RANK(CORR(RANK(0.1H+0.9VWAP), RANK(V), 11))) * -1 |
| 105 | `alpha_105` | -CORR(RANK(O), RANK(V), 10) |
| 108 | `alpha_108` | (RANK(H-MIN(H,2))^RANK(CORR(VWAP,MEAN(V,120),6))) * -1 |
| 113 | `alpha_113` | -RANK(SUM(DELAY(C,5),20)/20) * CORR(C,V,2) * RANK(CORR(SUM(C,5),SUM(C,20),2)) |
| 115 | `alpha_115` | RANK(CORR(0.9H+0.1C, MEAN(V,30), 10)) ^ RANK(CORR(TSRANK((H+L)/2,4), TSRANK(V,10), 7)) |
| 121 | `alpha_121` | (RANK(VWAP-MIN(VWAP,12)) ^ TSRANK(CORR(TSRANK(VWAP,20), TSRANK(MEAN(V,60),2), 18), 3)) * -1 |
| 123 | `alpha_123` | (RANK(CORR(SUM((H+L)/2,20), SUM(MEAN(V,60),20), 9)) < RANK(CORR(L,V,6))) * -1 |
| 131 | `alpha_131` | RANK(ΔVWAP,1) ^ TSRANK(CORR(C, MEAN(V,50), 18), 18) (DELAT→DELTA typo 修正) |
| 136 | `alpha_136` | -RANK(Δ(RET,3)) * CORR(O,V,10) |
| 139 | `alpha_139` | -CORR(O, V, 10) 开盘/量 10 日相关性取负 |
| 141 | `alpha_141` | -RANK(CORR(RANK(H), RANK(MEAN(V,15)), 9)) |
| 148 | `alpha_148` | RANK(CORR(O, SUM(MEAN(V,60),9), 6)) < RANK(O-TSMIN(O,14))  * -1 |
| 154 | `alpha_154` | (VWAP-MIN(VWAP,16)) < CORR(VWAP, MEAN(V,180), 18)  返回 0/1 |
| 176 | `alpha_176` | CORR(RANK((C-TSMIN(L,12))/(TSMAX(H,12)-TSMIN(L,12))), RANK(V), 6) |
| 179 | `alpha_179` | RANK(CORR(VWAP, V, 4)) * RANK(CORR(RANK(L), RANK(MEAN(V,50)), 12)) |
| 184 | `alpha_184` | RANK(CORR(DELAY(O-C,1), C, 200)) + RANK(O-C) |
| 191 | `alpha_191` | CORR(MEAN(V,20), L, 5) + (H+L)/2 - C |

## 动量 / 反转 (31)

| α# | 函数 | 描述 |
|---:|---|---|
| 9 | `alpha_9` | SMA(((H+L)/2 - DELAY((H+L)/2,1)) * (H-L)/V, 7, 2) |
| 14 | `alpha_14` | C - DELAY(C, 5) 5 日动量绝对值 |
| 15 | `alpha_15` | OPEN/DELAY(CLOSE,1) - 1 隔夜跳空 |
| 18 | `alpha_18` | C/DELAY(C, 5) 5 日累计涨幅 ratio |
| 19 | `alpha_19` | 3-way: C<DELAY(C,5)/C=DELAY(C,5)/C>DELAY(C,5) 归一化 |
| 20 | `alpha_20` | (C-DELAY(C,6))/DELAY(C,6)*100 6 日涨幅% |
| 22 | `alpha_22` | SMA((C/MA6 - DELAY(C/MA6, 3)), 12, 1) 偏离变化平滑 |
| 24 | `alpha_24` | SMA(C - DELAY(C,5), 5, 1) 平滑后的 5 日动量 |
| 29 | `alpha_29` | (C-DELAY(C,6))/DELAY(C,6)*VOL 量加权 6 日动量 |
| 33 | `alpha_33` | (-TSMIN(L,5)+DELAY(TSMIN(L,5),5)) * RANK((SUM(RET,240)-SUM(RET,20))/220) * TSRANK(V,5) |
| 37 | `alpha_37` | -RANK(SUM(O,5)*SUM(RET,5) - DELAY(SUM(O,5)*SUM(RET,5), 10)) |
| 38 | `alpha_38` | IF(MEAN(H,20)<H, -ΔH(2), 0) 突破均线的反转 |
| 43 | `alpha_43` | SUM(IF(C>DELAY(C,1), V, IF(C<DELAY(C,1), -V, 0)), 6) 6 日净量 |
| 53 | `alpha_53` | COUNT(C>DELAY(C,1), 12)/12*100 12 日上涨天数比例 |
| 55 | `alpha_55` | SUM(MFM, 20) 20 日复杂动量累加 |
| 58 | `alpha_58` | COUNT(C>DELAY(C,1), 20)/20*100 20 日上涨天数比例 |
| 80 | `alpha_80` | (VOL - DELAY(VOL,5))/DELAY(VOL,5)*100 5 日量变化% |
| 86 | `alpha_86` | 二阶差分: 0.25 < (DELAY(C,20)-DELAY(C,10))/10 - (DELAY(C,10)-C)/10 → -1; <0 → +1; 其他 → -ΔC |
| 88 | `alpha_88` | (C-DELAY(C,20))/DELAY(C,20)*100 20 日动量% |
| 106 | `alpha_106` | C - DELAY(C, 20) 20 日动量绝对值 |
| 107 | `alpha_107` | -RANK(O-DELAY(H,1)) * RANK(O-DELAY(C,1)) * RANK(O-DELAY(L,1)) |
| 110 | `alpha_110` | SUM(MAX(0,H-DELAY(C,1)), 20) / SUM(MAX(0,DELAY(C,1)-L), 20) × 100 |
| 114 | `alpha_114` | (RANK(DELAY(振幅率,2)) * RANK(RANK(V))) / (振幅率 / (VWAP-C)) |
| 134 | `alpha_134` | (C-DELAY(C,12))/DELAY(C,12)*V 12 日量加权动量 |
| 135 | `alpha_135` | SMA(DELAY(C/DELAY(C,20),1), 20, 1) 滞后 20 日动量平滑 |
| 144 | `alpha_144` | SUMIF(\|ΔC/C\|/AMOUNT, 20, C<DELAY(C,1)) / COUNT(C<DELAY(C,1), 20) |
| 151 | `alpha_151` | SMA(C - DELAY(C,20), 20, 1) 20 日动量平滑 |
| 157 | `alpha_157` | MIN(PROD(RANK(RANK(LOG(SUM(TSMIN(RANK^3(-ΔC,5)),2),1))),1),5) + TSRANK(DELAY(-RET,6),5) |
| 167 | `alpha_167` | SUM(MAX(C-DELAY(C,1),0), 12) 12 日上涨幅度累加 |
| 170 | `alpha_170` | 复合: RANK(1/C)*V/MEAN(V,20) * H*RANK(H-C)/(SUM(H,5)/5) - RANK(VWAP-DELAY(VWAP,5)) |
| 178 | `alpha_178` | (C-DELAY(C,1))/DELAY(C,1) * V 当日涨跌幅 × 量 |

## 波动 / ATR (17)

| α# | 函数 | 描述 |
|---:|---|---|
| 4 | `alpha_4` | 复杂条件：均线+STD+量能比 |
| 10 | `alpha_10` | RANK(MAX((RET<0?STD(RET,20):CLOSE)^2, 5)) |
| 23 | `alpha_23` | 20 日上涨日波动占总波动比例 (论文 STD(CLOSE:20),0 视为 STD(CLOSE,20) typo 修正) |
| 42 | `alpha_42` | -RANK(STD(H, 10)) * CORR(H, V, 10) |
| 54 | `alpha_54` | -RANK(STD(\|C-O\|) + (C-O) + CORR(C,O,10)) |
| 70 | `alpha_70` | STD(AMOUNT, 6) 6 日成交额波动 |
| 76 | `alpha_76` | STD(\|ret\|/V, 20) / MEAN(\|ret\|/V, 20) 单位量振幅的离散系数 |
| 95 | `alpha_95` | STD(AMOUNT, 20) 20 日成交额波动 |
| 97 | `alpha_97` | STD(VOLUME, 10) 10 日量波动 |
| 100 | `alpha_100` | STD(VOL, 20) 20 日量波动 |
| 104 | `alpha_104` | -ΔCORR(H,V,5)(5) * RANK(STD(C,20)) |
| 160 | `alpha_160` | SMA(IF(C<=DELAY(C,1), STD(C,20), 0), 20, 1) |
| 161 | `alpha_161` | MEAN(TR, 12) 12 日 ATR |
| 165 | `alpha_165` | TSMAX(SUMAC(C-MEAN(C,48)),48) - TSMIN(SUMAC(...),48) / STD(C,48) |
| 174 | `alpha_174` | SMA(IF(C>DELAY(C,1), STD(C,20), 0), 20, 1) |
| 175 | `alpha_175` | MEAN(TR, 6) 6 日 ATR |
| 183 | `alpha_183` | TSMAX(SUMAC(C-MEAN(C,24)),24) - TSMIN(SUMAC(...),24) / STD(C,24) |

## DECAY / CORR 组合 (16)

| α# | 函数 | 描述 |
|---:|---|---|
| 25 | `alpha_25` | -RANK(ΔC*((1-RANK(DECAY))) * (1+RANK(SUM(RET,250)))) |
| 35 | `alpha_35` | MIN(RANK(DECAY(ΔO,15)), RANK(DECAY(CORR(V, O*混合, 17), 7))) * -1 |
| 39 | `alpha_39` | (RANK(DECAY(ΔC,2),8)) - RANK(DECAY(CORR(0.3VWAP+0.7O, SUM(MEAN(V,180),37), 14),12))) * -1 |
| 44 | `alpha_44` | TSRANK(DECAY(CORR(L, MEAN(V,10),7),6),4) + TSRANK(DECAY(ΔVWAP,3),10),15) |
| 61 | `alpha_61` | MAX(RANK(DECAY(ΔVWAP,12)), RANK(DECAY(RANK(CORR(L,MEAN(V,80),8)),17))) * -1 |
| 64 | `alpha_64` | MAX(RANK(DECAY(CORR(RANK(VWAP),RANK(V),4),4)), RANK(DECAY(MAX(CORR(RANK(C),RANK(MEAN(V,60)),4),13),14))) * -1 |
| 73 | `alpha_73` | (TSRANK(DECAY(DECAY(CORR(C,V,10),16),4),5) - RANK(DECAY(CORR(VWAP,MEAN(V,30),4),3))) * -1 |
| 77 | `alpha_77` | MIN(RANK(DECAY(((H+L)/2+H-(VWAP+H)),20)), RANK(DECAY(CORR((H+L)/2,MEAN(V,40),3),6))) |
| 92 | `alpha_92` | MAX(RANK(DECAY(Δ(0.35C+0.65VWAP,2),3)), TSRANK(DECAY(\|CORR(MEAN(V,180),C,13)\|,5),15)) * -1 |
| 119 | `alpha_119` | 复合 DECAY+TSRANK: RANK(DECAY(CORR(VWAP, SUM(MEAN(V,5),26), 5),7)) - RANK(DECAY(TSRANK(MIN(CORR),9),7),8) |
| 124 | `alpha_124` | (C-VWAP) / DECAY(RANK(TSMAX(C,30)), 2) |
| 125 | `alpha_125` | RANK(DECAY(CORR(VWAP,MEAN(V,80),17),20)) / RANK(DECAY(Δ(0.5C+0.5VWAP,3),16)) |
| 130 | `alpha_130` | RANK(DECAY(CORR((H+L)/2, MEAN(V,40), 9), 10)) / RANK(DECAY(CORR(RANK(VWAP),RANK(V),7),3)) |
| 138 | `alpha_138` | (RANK(DECAY(Δ(0.7L+0.3VWAP,3),20)) - TSRANK(DECAY(TSRANK(CORR(TSRANK(L,8),TSRANK(MEAN(V,60),17),5),19),16),7)) * -1 |
| 140 | `alpha_140` | MIN(RANK(DECAY((RANK(O)+RANK(L))-(RANK(H)+RANK(C)),8)), TSRANK(DECAY(CORR(TSRANK(C,8),TSRANK(MEAN(V,60),20),8),7),3)) |
| 156 | `alpha_156` | MAX(RANK(DECAY(ΔVWAP,5),3), RANK(DECAY(-Δ(0.15O+0.85L,2)/...),3)) * -1 |

## MFI / 资金流 (12)

| α# | 函数 | 描述 |
|---:|---|---|
| 3 | `alpha_3` | 6 日累计资金流向（带前日收盘上/下穿条件） |
| 11 | `alpha_11` | SUM(((C-L)-(H-C))/(H-L) * V, 6) 6 日资金流向 |
| 52 | `alpha_52` | MFI-like: 12 日上向资金流 / 下向资金流 × 100 |
| 59 | `alpha_59` | 20 日累计资金流向（Alpha3 的 20 日版本） |
| 60 | `alpha_60` | SUM(((C-L)-(H-C))/(H-L)*V, 20) 20 日资金流向 |
| 78 | `alpha_78` | CCI-like: ((H+L+C)/3 - MA12) / (0.015 * MAD) |
| 84 | `alpha_84` | SUM(signed_volume, 20) 20 日 OBV |
| 94 | `alpha_94` | SUM(signed_volume, 30) 30 日 OBV |
| 128 | `alpha_128` | MFI: 100 - 100/(1+upflow/downflow) |
| 150 | `alpha_150` | (C+H+L)/3 * VOL 当日资金流 |
| 159 | `alpha_159` | 加权三周期 MFI: 6/12/24 日窗口加权（HGIH→HIGH typo 修正） |
| 189 | `alpha_189` | MEAN(\|C-MEAN(C,6)\|, 6) 收盘偏离 6 日均线的 MAD |

## KDJ / RSI / WR (11)

| α# | 函数 | 描述 |
|---:|---|---|
| 28 | `alpha_28` | 3*SMA(KDJ_K, 3, 1) - 2*SMA(SMA(KDJ_K, 3, 1), 3, 1) KDJ J 值 |
| 47 | `alpha_47` | SMA(WR(6), 9, 1) 威廉指标平滑 |
| 57 | `alpha_57` | SMA(KDJ-K, 3, 1) 经典 KDJ K 值 |
| 63 | `alpha_63` | 6 日 RSI 类指标（上涨幅度 SMA / 总变动 SMA × 100） |
| 67 | `alpha_67` | 24 日 RSI 类指标 |
| 72 | `alpha_72` | SMA(WR(6), 15, 1) |
| 79 | `alpha_79` | 12 日 RSI 类指标 (SMA up / SMA abs × 100) |
| 82 | `alpha_82` | SMA(((TSMAX(H,6)-C)/(TSMAX(H,6)-TSMIN(L,6)))*100, 20, 1) WR 平滑 |
| 96 | `alpha_96` | SMA(SMA(KDJ-RSV, 3, 1), 3, 1) KDJ D 值类 |
| 112 | `alpha_112` | 12 日 RSI 形式（涨跌幅累加比） |
| 162 | `alpha_162` | 标准化 RSI: (RSI - TSMIN(RSI,12)) / (TSMAX(RSI,12) - TSMIN(RSI,12)) |

## 极值位置 (5)

| α# | 函数 | 描述 |
|---:|---|---|
| 2 | `alpha_2` | -Δ(((C-L)-(H-C))/(H-L), 1) 当日收盘位置变化反向 |
| 87 | `alpha_87` | RANK(DECAY(ΔVWAP,7)) + TSRANK(DECAY(影线相对位置,11),7)) * -1 |
| 103 | `alpha_103` | ((20-LOWDAY(LOW,20))/20)*100 低点位置位次 |
| 133 | `alpha_133` | ((20-HIGHDAY)/20 - (20-LOWDAY)/20) * 100 高低点位置差 |
| 177 | `alpha_177` | ((20-HIGHDAY(HIGH,20))/20)*100 高点位置位次 |

## 多周期均线 (5)

| α# | 函数 | 描述 |
|---:|---|---|
| 46 | `alpha_46` | (MA3+MA6+MA12+MA24)/(4*C) 多周期均线/现价 |
| 127 | `alpha_127` | sqrt(mean((100*(C-MAX(C,12))/MAX(C,12))^2)) |
| 152 | `alpha_152` | SMA(MEAN(DELAY(SMA(DELAY(C/DELAY(C,9),1),9,1),1),12) - MEAN(...,26), 9, 1) |
| 153 | `alpha_153` | (MA3+MA6+MA12+MA24)/4 多周期均线平均 |
| 169 | `alpha_169` | SMA(MEAN(DELAY(SMA(ΔC,9,1),1),12) - MEAN(...,26), 10, 1) |

## ADX / DTM / DBM (5)

| α# | 函数 | 描述 |
|---:|---|---|
| 69 | `alpha_69` | DTM/DBM 比率（多空压力相对强度） |
| 93 | `alpha_93` | SUM(IF(O>=DELAY(O,1), 0, MAX(O-L, O-DELAY(O,1))), 20) DBM 累加 |
| 172 | `alpha_172` | MEAN(ADX, 6) 6 日 ADX 平均 |
| 186 | `alpha_186` | (MEAN(ADX,6) + DELAY(MEAN(ADX,6), 6)) / 2  双周期 ADX |
| 187 | `alpha_187` | SUM(IF(O<=DELAY(O,1), 0, MAX(H-O, O-DELAY(O,1))), 20) DTM 累加 |

## 趋势回归 (3)

| α# | 函数 | 描述 |
|---:|---|---|
| 21 | `alpha_21` | REGBETA(MEAN(C,6), SEQUENCE(6)) 6 日均线趋势斜率 |
| 116 | `alpha_116` | REGBETA(C, SEQUENCE, 20) 20 日 close 时间趋势斜率 |
| 147 | `alpha_147` | REGBETA(MEAN(C,12), SEQUENCE(12)) 12 日均线趋势斜率 |

## 基准依赖 (3)

| α# | 函数 | 描述 |
|---:|---|---|
| 75 | `alpha_75` | COUNT(C>O & BENCH_C<BENCH_O, 50) / COUNT(BENCH_C<BENCH_O, 50) 大盘下跌日个股逆势涨频率 |
| 149 | `alpha_149` | REGBETA(下跌日 stock_ret, 下跌日 bench_ret, 252) 下行 beta |
| 182 | `alpha_182` | COUNT((C>O & BENCH_C>BENCH_O) \| (C<O & BENCH_C<BENCH_O), 20) / 20 同向涨跌频率 |

## TRIX / MACD (3)

| α# | 函数 | 描述 |
|---:|---|---|
| 89 | `alpha_89` | DMA-MACD: 2*(SMA13 - SMA27 - SMA(SMA13-SMA27, 10)) |
| 146 | `alpha_146` | MEAN(ret-EMA61(ret),20) × (ret-EMA61(ret)) / SMA(EMA61(ret)^2,60) |
| 155 | `alpha_155` | 量版 MACD: SMA(V,13,2) - SMA(V,27,2) - SMA(SMA(V,13,2)-SMA(V,27,2),10,2) |

## 复杂条件 (2)

| α# | 函数 | 描述 |
|---:|---|---|
| 164 | `alpha_164` | SMA(条件化倒数差分 / (H-L) × 100, 13, 2) |
| 190 | `alpha_190` | 20 日下行 vs 上行偏离的对数比 (复杂 SUMIF 重构) |
