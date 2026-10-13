/**
 * Service to handle browser notifications with graceful permission handling
 */
export class NotificationService {
  isSupported(): boolean {
    return typeof window !== 'undefined' && 'Notification' in window;
  }

  async requestPermission(): Promise<boolean> {
    if (!this.isSupported()) return false;
    try {
      const permission = await Notification.requestPermission();
      return permission === 'granted';
    } catch {
      return false;
    }
  }

  hasPermission(): boolean {
    if (!this.isSupported()) return false;
    return Notification.permission === 'granted';
  }

  notify(title: string, body: string): void {
    if (!this.hasPermission()) return;
    try {
      new Notification(title, {
        body,
        icon: '/favicon.svg',
      });
    } catch (err) {
      console.warn('Unable to dispatch notification:', err);
    }
  }
}

export const notificationService = new NotificationService();
