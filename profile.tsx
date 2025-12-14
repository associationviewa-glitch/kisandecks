import { useState, useRef } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, User, Phone, Mail, MapPin, Camera, Edit2, Save, Globe, Loader2 } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

export default function ProfilePage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: farmerAuth, isLoading } = useQuery({
    queryKey: ["/api/farmer/me"],
    queryFn: async () => {
      const res = await fetch("/api/farmer/me", { credentials: "include" });
      return res.json();
    },
  });

  const isLoggedIn = farmerAuth?.authenticated === true;
  const farmer = farmerAuth?.farmer;

  const [formData, setFormData] = useState({
    name: farmer?.name || "",
    email: farmer?.email || "",
    village: farmer?.village || "",
    district: farmer?.district || "",
    state: farmer?.state || "",
    language: farmer?.language || "hindi",
  });

  const updateMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const res = await fetch("/api/farmer/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Update failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/farmer/me"] });
      toast({ title: "Profile Updated!", description: "प्रोफाइल अपडेट हो गई" });
      setIsEditing(false);
    },
    onError: () => {
      toast({ title: "Update Failed", description: "कुछ गलत हो गया", variant: "destructive" });
    },
  });

  const photoUploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("photo", file);
      const res = await fetch("/api/farmer/profile-photo", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) throw new Error("Upload failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/farmer/me"] });
      toast({ title: "Photo Updated!", description: "फोटो अपडेट हो गई" });
    },
    onError: () => {
      toast({ title: "Upload Failed", description: "फोटो अपलोड नहीं हो सकी", variant: "destructive" });
    },
  });

  const handlePhotoClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        toast({ title: "File too large", description: "फोटो 5MB से छोटी होनी चाहिए", variant: "destructive" });
        return;
      }
      if (!file.type.startsWith("image/")) {
        toast({ title: "Invalid file", description: "कृपया एक इमेज फाइल चुनें", variant: "destructive" });
        return;
      }
      photoUploadMutation.mutate(file);
    }
  };

  if (!isLoggedIn && !isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center">
          <User className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
          <h2 className="text-xl font-bold text-foreground mb-2">Login Required</h2>
          <p className="text-muted-foreground mb-4">प्रोफाइल देखने के लिए लॉगिन करें</p>
          <Link href="/farmer/login">
            <Button className="bg-emerald-600 hover:bg-emerald-700">Login / लॉगिन</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <nav className="bg-card/90 backdrop-blur-sm border-b border-border sticky top-0 z-40">
        <div className="container mx-auto px-4 h-16 flex items-center">
          <Link href="/">
            <Button variant="ghost" size="icon" className="mr-2 h-12 w-12" data-testid="button-back">
              <ArrowLeft className="h-6 w-6" />
            </Button>
          </Link>
          <div className="flex items-center gap-3">
            <div className="bg-gradient-to-br from-emerald-500 to-green-600 text-white p-2 rounded-xl">
              <User size={24} />
            </div>
            <div>
              <h1 className="font-heading font-bold text-lg text-foreground leading-tight">My Profile</h1>
              <p className="text-sm text-muted-foreground">मेरी प्रोफाइल</p>
            </div>
          </div>
        </div>
      </nav>

      <div className="container mx-auto px-4 py-6 max-w-md">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-6"
        >
          <div className="bg-gradient-to-br from-emerald-500 to-green-600 rounded-3xl p-6 text-center">
            <div className="relative inline-block">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileChange}
                data-testid="input-profile-photo"
              />
              <div className="w-24 h-24 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-4 overflow-hidden">
                {farmer?.profilePhoto ? (
                  <img 
                    src={farmer.profilePhoto} 
                    alt="Profile" 
                    className="w-full h-full object-cover"
                    data-testid="img-profile-photo"
                  />
                ) : (
                  <User className="w-12 h-12 text-white" />
                )}
              </div>
              <button 
                onClick={handlePhotoClick}
                disabled={photoUploadMutation.isPending}
                className="absolute bottom-3 right-0 w-8 h-8 bg-white rounded-full shadow-lg flex items-center justify-center hover:bg-gray-50 transition-colors disabled:opacity-50"
                data-testid="button-upload-photo"
              >
                {photoUploadMutation.isPending ? (
                  <Loader2 className="w-4 h-4 text-emerald-600 animate-spin" />
                ) : (
                  <Camera className="w-4 h-4 text-emerald-600" />
                )}
              </button>
            </div>
            <h2 className="text-xl font-bold text-white">{farmer?.name || "Farmer"}</h2>
            <p className="text-emerald-100">{farmer?.phone}</p>
          </div>

          <div className="bg-card rounded-3xl shadow-lg border border-border p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg text-foreground">Profile Details</h3>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (isEditing) {
                    updateMutation.mutate(formData);
                  } else {
                    setFormData({
                      name: farmer?.name || "",
                      email: farmer?.email || "",
                      village: farmer?.village || "",
                      district: farmer?.district || "",
                      state: farmer?.state || "",
                      language: farmer?.language || "hindi",
                    });
                    setIsEditing(true);
                  }
                }}
                disabled={updateMutation.isPending}
                data-testid="button-edit-profile"
              >
                {isEditing ? (
                  <><Save className="w-4 h-4 mr-2" /> Save</>
                ) : (
                  <><Edit2 className="w-4 h-4 mr-2" /> Edit</>
                )}
              </Button>
            </div>

            <div className="space-y-4">
              <div>
                <Label className="flex items-center gap-2 mb-2">
                  <User className="w-4 h-4 text-primary" /> Name / नाम
                </Label>
                {isEditing ? (
                  <Input
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="h-12"
                    data-testid="input-name"
                  />
                ) : (
                  <p className="h-12 flex items-center px-3 bg-muted rounded-lg text-foreground">{farmer?.name || "-"}</p>
                )}
              </div>

              <div>
                <Label className="flex items-center gap-2 mb-2">
                  <Phone className="w-4 h-4 text-primary" /> Mobile / मोबाइल
                </Label>
                <p className="h-12 flex items-center px-3 bg-muted rounded-lg text-foreground">{farmer?.phone || "-"}</p>
              </div>

              <div>
                <Label className="flex items-center gap-2 mb-2">
                  <Mail className="w-4 h-4 text-primary" /> Email (Optional)
                </Label>
                {isEditing ? (
                  <Input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="h-12"
                    placeholder="email@example.com"
                    data-testid="input-email"
                  />
                ) : (
                  <p className="h-12 flex items-center px-3 bg-muted rounded-lg text-foreground">{farmer?.email || "-"}</p>
                )}
              </div>

              <div>
                <Label className="flex items-center gap-2 mb-2">
                  <MapPin className="w-4 h-4 text-primary" /> Village / गांव
                </Label>
                {isEditing ? (
                  <Input
                    value={formData.village}
                    onChange={(e) => setFormData({ ...formData, village: e.target.value })}
                    className="h-12"
                    data-testid="input-village"
                  />
                ) : (
                  <p className="h-12 flex items-center px-3 bg-muted rounded-lg text-foreground">{farmer?.village || "-"}</p>
                )}
              </div>

              <div>
                <Label className="flex items-center gap-2 mb-2">
                  <Globe className="w-4 h-4 text-primary" /> Language / भाषा
                </Label>
                {isEditing ? (
                  <Select value={formData.language} onValueChange={(val) => setFormData({ ...formData, language: val })}>
                    <SelectTrigger className="h-12" data-testid="select-language">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hindi">हिंदी (Hindi)</SelectItem>
                      <SelectItem value="english">English</SelectItem>
                      <SelectItem value="marathi">मराठी (Marathi)</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="h-12 flex items-center px-3 bg-muted rounded-lg text-foreground capitalize">{farmer?.language || "Hindi"}</p>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
