import { motion, AnimatePresence } from "framer-motion";
import { 
  Menu, X, User, Settings, Info, Phone, HelpCircle, 
  Shield, FileText, Lock, LogOut, ChevronRight, Leaf, AlertCircle
} from "lucide-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/contexts/language-context";

interface NavigationDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export function NavigationDrawer({ isOpen, onClose }: NavigationDrawerProps) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { t } = useLanguage();

  const menuItems = [
    { id: "profile", labelKey: "drawer.profile", icon: User, href: "/profile", color: "text-emerald-600" },
    { id: "settings", labelKey: "drawer.settings", icon: Settings, href: "/settings", color: "text-blue-600" },
    { id: "about", labelKey: "drawer.about", icon: Info, href: "/about", color: "text-purple-600" },
    { id: "contact", labelKey: "drawer.contact", icon: Phone, href: "/contact", color: "text-orange-600" },
    { id: "support", labelKey: "drawer.support", icon: HelpCircle, href: "/support", color: "text-pink-600" },
    { id: "report", labelKey: "drawer.reportIssue", icon: AlertCircle, href: "/support", color: "text-amber-600" },
    { id: "privacy", labelKey: "drawer.privacy", icon: Shield, href: "/privacy", color: "text-indigo-600" },
    { id: "terms", labelKey: "drawer.terms", icon: FileText, href: "/terms", color: "text-teal-600" },
    { id: "security", labelKey: "drawer.security", icon: Lock, href: "/security", color: "text-red-600" },
  ];

  const { data: farmerAuth } = useQuery({
    queryKey: ["/api/farmer/me"],
    queryFn: async () => {
      const res = await fetch("/api/farmer/me", { credentials: "include" });
      return res.json();
    },
  });

  const isLoggedIn = farmerAuth?.authenticated === true;
  const farmer = farmerAuth?.farmer;

  const logoutMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/farmer/logout", { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error("Logout failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/farmer/me"] });
      toast({ title: t("auth.logoutSuccess"), description: t("auth.logoutSuccess") });
      onClose();
      setTimeout(() => setLocation("/farmer/login"), 100);
    },
    onError: () => {
      toast({ title: t("common.error"), description: t("common.retry"), variant: "destructive" });
    },
  });

  const handleNavigation = (href: string) => {
    onClose();
    setLocation(href);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/50 z-50"
            onClick={onClose}
            data-testid="drawer-overlay"
          />
          
          <motion.div
            initial={{ x: "-100%" }}
            animate={{ x: 0 }}
            exit={{ x: "-100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="fixed left-0 top-0 bottom-0 w-[85%] max-w-[320px] bg-card z-50 shadow-2xl flex flex-col"
            data-testid="navigation-drawer"
          >
            <div className="bg-gradient-to-br from-emerald-500 to-green-600 p-6 pb-8">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <div className="bg-white/20 p-2 rounded-xl">
                    <Leaf className="w-6 h-6 text-white" />
                  </div>
                  <span className="font-bold text-xl text-white">{t("app.name")}</span>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onClose}
                  className="text-white hover:bg-white/20"
                  data-testid="button-close-drawer"
                >
                  <X className="w-6 h-6" />
                </Button>
              </div>
              
              {isLoggedIn ? (
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center overflow-hidden">
                    {farmer?.profilePhoto ? (
                      <img 
                        src={farmer.profilePhoto} 
                        alt="Profile" 
                        className="w-full h-full object-cover"
                        data-testid="img-drawer-profile"
                      />
                    ) : (
                      <User className="w-8 h-8 text-white" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-lg text-white truncate">{farmer?.name || t("drawer.farmer")}</p>
                    <p className="text-emerald-100 text-sm">{farmer?.phone}</p>
                    <p className="text-emerald-200 text-xs mt-1">
                      {farmer?.village ? `${farmer.village}` : t("home.welcome") + "!"}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center">
                    <User className="w-8 h-8 text-white" />
                  </div>
                  <div className="flex-1">
                    <p className="font-bold text-lg text-white">{t("home.welcome")}!</p>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleNavigation("/farmer/login")}
                      className="mt-2"
                      data-testid="button-login-drawer"
                    >
                      {t("drawer.loginRegister")}
                    </Button>
                  </div>
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto py-4">
              {menuItems.map((item, index) => (
                <motion.button
                  key={item.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.05 }}
                  onClick={() => handleNavigation(item.href)}
                  className="w-full flex items-center gap-4 px-6 py-4 hover:bg-accent active:bg-accent/80 transition-colors"
                  data-testid={`menu-item-${item.id}`}
                >
                  <div className={`w-10 h-10 rounded-xl bg-muted flex items-center justify-center ${item.color}`}>
                    <item.icon className="w-5 h-5" />
                  </div>
                  <div className="flex-1 text-left">
                    <p className="font-bold text-foreground">{t(item.labelKey)}</p>
                  </div>
                  <ChevronRight className="w-5 h-5 text-muted-foreground" />
                </motion.button>
              ))}
            </div>

            <div className="border-t border-border p-4">
              {isLoggedIn ? (
                <Button
                  variant="outline"
                  className="w-full h-14 text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700 dark:border-red-900 dark:hover:bg-red-950 gap-2 font-semibold"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    logoutMutation.mutate();
                  }}
                  disabled={logoutMutation.isPending}
                  data-testid="button-logout-drawer"
                >
                  <LogOut className="w-5 h-5" />
                  {logoutMutation.isPending ? t("common.loading") : t("auth.logout")}
                </Button>
              ) : (
                <Button
                  className="w-full h-14 bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 gap-2 font-semibold"
                  onClick={() => handleNavigation("/farmer/login")}
                  data-testid="button-login-bottom"
                >
                  <User className="w-5 h-5" />
                  {t("drawer.loginRegister")}
                </Button>
              )}
            </div>

            <div className="border-t border-border p-4 bg-muted/50">
              <p className="text-center text-xs text-foreground font-medium">
                {t("app.name")} {t("drawer.version")} 1.0.0
              </p>
              <p className="text-center text-xs text-muted-foreground mt-1">
                {t("drawer.madeWith")} ❤️
              </p>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export function HamburgerButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={onClick}
      className="h-12 w-12 hover:bg-accent"
      data-testid="button-hamburger-menu"
    >
      <Menu className="w-6 h-6 text-foreground" />
    </Button>
  );
}
