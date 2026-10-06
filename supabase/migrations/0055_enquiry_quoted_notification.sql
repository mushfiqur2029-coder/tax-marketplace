-- Client-facing notification fired by createBespokeCaseFromEnquiryAction
-- when admin turns an enquiry into a priced case. The client's bell
-- lands them on the new case where they sign the engagement letter and
-- pay the quoted fee.

alter type public.notification_type add value if not exists 'enquiry_quoted';
