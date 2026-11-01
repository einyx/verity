import { useTranslation } from 'react-i18next';

import { securityFeaturesAddOnUnitPrice } from '@/consts/subscriptions';
import InlineNotification from '@/ds-components/InlineNotification';
import usePaywall from '@/hooks/use-paywall';
import useUserPreferences from '@/hooks/use-user-preferences';

type Props = {
  readonly className?: string;
};

function PaywallNotification({ className }: Props) {
  const { t } = useTranslation(undefined, { keyPrefix: 'admin_console' });
  const { isPaidTenant } = usePaywall();

  const {
    data: { securityFeaturesUpsellNoticeAcknowledged },
    update,
  } = useUserPreferences();

  if (isPaidTenant && !securityFeaturesUpsellNoticeAcknowledged) {
    return (
      <InlineNotification
        className={className}
        action="general.got_it"
        onClick={async () => update({ securityFeaturesUpsellNoticeAcknowledged: true })}
      >
        {t('upsell.add_on.security_features_inline_notification', {
          price: securityFeaturesAddOnUnitPrice,
        })}
      </InlineNotification>
    );
  }

  return null;
}

export default PaywallNotification;
