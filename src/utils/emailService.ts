import { Resend } from 'resend';
import { createLogger } from './logger.js';

const resend = new Resend(process.env.RESEND_API_KEY);
const logger = createLogger('Email');
// Skip email sending only in test mode (to avoid polluting inboxes with test data)
const shouldSkipEmails = process.env.RUN_ENV === 'test';

export interface EmailOptions {
    to: string | string[];
    subject: string;
    htmlContent: string;
    textContent?: string;
}

/**
 * Send email using Resend API (HTTPS - 完美穿透 VPN)
 * Supports test mode via RUN_ENV=test
 * @param options Email options
 * @returns Result with messageId or error
 */
export async function sendEmail(options: EmailOptions) {
    // Test mode: Skip actual email sending
    if (shouldSkipEmails) {
        const mockMessageId = `mock-msg-${Date.now()}`;
        logger.debug(`Skipped Resend API call in test mode (mock message_id=${mockMessageId})`);
        return {
            success: true,
            messageId: mockMessageId,
        };
    }

    try {
        // 🎯 注意：这里的发件人域名必须是你刚才在 AWS 验证的 ntdoc.site
        // 你可以随意更改前缀，比如 support@, noreply@, admin@ 等等
        const senderEmail = 'CeramiCraft Reviews Moderate <ai.moderate@auto.ntdoc.site>';
        
        logger.info(`Sending email via Resend to ${typeof options.to === 'string' ? options.to : options.to.join(', ')}`);
        
        // 🚀 直接调接口，底层就是 fetch，稳如老狗
        const { data, error } = await resend.emails.send({
            from: senderEmail,
            to: options.to,
            subject: options.subject,
            html: options.htmlContent,
            ...(options.textContent ? { text: options.textContent } : {}),
        });

        // Resend 把业务错误也封装在了 error 对象里，不会直接抛出异常
        if (error) {
            logger.error(`Resend API Error:`, error);
            return {
                success: false,
                error: error.message,
            };
        }

        logger.info(`✅ Email sent successfully (ID: ${data?.id})`);
        return {
            success: true,
            messageId: data?.id,
        };
    } catch (error: any) {
        // 捕获网络层面的极端异常
        logger.error(`Exception:`, error.message);
        return {
            success: false,
            error: error.message,
        };
    }
}

/**
 * Send review moderation notification to admin
 * @param adminEmail Admin email address
 * @param reviewId Review ID
 * @param userId User ID
 * @param content Review content text
 * @param decision Final decision (approved/hidden/rejected)
 * @param autoFlag Auto flags
 * @param reasoning Detailed reasoning logs
 * @param afterSalesDraft Optional after-sales information
 * @param isRejected Whether this is a rejected review (dangerous user)
 */
export async function sendModerationNotification(
    adminEmail: string,
    reviewId: string,
    userId: string | number | undefined,
    content: string,
    decision: 'approved' | 'hidden' | 'rejected',
    autoFlag: string | null,
    afterSalesDraft?: { summary: string; solution: string; script: string } | null,
    isRejected: boolean = false
) {
    const decisionColor = decision === 'approved' ? '#28a745' : decision === 'hidden' ? '#ffc107' : '#dc3545';
    
    let afterSalesSection = '';
    if (afterSalesDraft) {
        afterSalesSection = `
            <div style="background-color: #fff3cd; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #ffc107;">
                <h3 style="color: #856404; margin-top: 0;">⚠️ After-Sales Issue Detected</h3>
                <p><strong>Issue Summary:</strong></p>
                <p style="font-style: italic;">${afterSalesDraft.summary}</p>
                
                <p><strong>Recommended Solution:</strong></p>
                <p>${afterSalesDraft.solution}</p>
                
                <p><strong>Customer Service Script:</strong></p>
                <div style="background-color: #fff; padding: 10px; border-radius: 3px; border: 1px solid #ffe69c;">
                    <pre style="margin: 0; white-space: pre-wrap; word-wrap: break-word;">${afterSalesDraft.script}</pre>
                </div>
            </div>
        `;
    }
    
    const htmlContent = `
        <div style="font-family: Arial, sans-serif; line-height: 1.6;">
            <h2>Review Moderation Alert</h2>
            
            ${isRejected ? `
                <div style="background-color: #f8d7da; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #dc3545;">
                    <h3 style="color: #721c24; margin-top: 0;">⚠️ 🚨 DANGEROUS USER ALERT 🚨</h3>
                    <p style="font-weight: bold; color: #721c24;">This review has been REJECTED due to harmful, unsafe, or spam content.</p>
                    <p style="margin: 10px 0;">User ID: <code>${userId}</code> may be engaging in malicious activity. Consider:</p>
                    <ul style="color: #721c24;">
                        <li>Flagging user account for further investigation</li>
                        <li>Checking user's review history for patterns</li>
                        <li>Possible account suspension if repeated violations</li>
                    </ul>
                </div>
            ` : ''}
            
            <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid ${decisionColor};">
                <p><strong>Review ID:</strong> <code>${reviewId}</code></p>
                ${userId ? `<p><strong>User ID:</strong> <code>${userId}</code></p>` : ''}
                <p><strong>Final Decision:</strong> <span style="color: ${decisionColor}; font-weight: bold; font-size: 18px;">${decision.toUpperCase()}</span></p>
                ${autoFlag ? `<p><strong>Flags:</strong> <code style="background-color: #f0f0f0; padding: 2px 6px; border-radius: 3px;">${autoFlag}</code></p>` : '<p><strong>Flags:</strong> None</p>'}
            </div>
            
            <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
                <p><strong>Review Content:</strong></p>
                <p style="border-left: 3px solid #ccc; padding-left: 12px; font-style: italic; margin: 10px 0;">"${content}"</p>
            </div>
            
            ${afterSalesSection}
            
            <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
            <p style="color: #666; font-size: 12px;">This is an automated review moderation notification. Please review carefully and take appropriate action.</p>
        </div>
    `;

    return sendEmail({
        to: adminEmail,
        subject: `[Review Moderation] ${decision.toUpperCase()} - Review ${reviewId}`,
        htmlContent,
    });
}
