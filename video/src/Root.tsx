import { Composition } from "remotion";
import { Promo, PROMO_DURATION } from "./Promo";
import { VerticalPromo, VPROMO_DURATION } from "./VerticalPromo";
import { VerticalPromoPro, VPRO_DURATION } from "./VerticalPromoPro";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="Promo"
        component={Promo}
        durationInFrames={PROMO_DURATION}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="PromoVertical"
        component={VerticalPromo}
        durationInFrames={VPROMO_DURATION}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="PromoVerticalPro"
        component={VerticalPromoPro}
        durationInFrames={VPRO_DURATION}
        fps={30}
        width={1080}
        height={1920}
      />
    </>
  );
};
